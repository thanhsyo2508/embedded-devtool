//! Lua-based plugin engine: custom protocol decoders and custom plotter
//! parsers, installed/named/reusable (see `src/state/pluginLibraryStore.ts`
//! on the frontend) rather than the free-form per-tab code the existing
//! `script` module runs. Deliberately much narrower than a script: a plugin
//! exposes exactly one pure function (`decode(line)` or `parse(line)`) that
//! returns a table of fields, called automatically for every line — no
//! `send`/`wait_for`/`timer` globals, since a plugin isn't meant to drive
//! the device, only describe how to read what it already sends.
//!
//! Threading mirrors `script::run_on_thread`: one dedicated OS thread per
//! running plugin, its own `mlua::Lua` instance, subscribed to the same
//! `EventBus` the rest of the app already publishes to.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use crossbeam_channel::RecvTimeoutError;
use mlua::{Lua, Value};
use serde::Deserialize;

use crate::core::event_bus::{Event, EventBus};

const POLL_INTERVAL_MS: u64 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PluginKind {
    Decoder,
    PlotterParser,
}

pub struct PluginCallbacks {
    pub on_decoded: Arc<dyn Fn(HashMap<String, String>) + Send + Sync>,
    pub on_plot: Arc<dyn Fn(String, f64) + Send + Sync>,
    pub on_error: Arc<dyn Fn(String) + Send + Sync>,
    pub on_done: Arc<dyn Fn() + Send + Sync>,
}

struct RunningPlugin {
    stop_flag: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

#[derive(Default)]
pub struct PluginManager {
    running: Mutex<HashMap<String, RunningPlugin>>,
}

impl PluginManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn run(
        self: &Arc<Self>,
        run_id: String,
        stream_id: String,
        kind: PluginKind,
        code: String,
        event_bus: EventBus,
        callbacks: PluginCallbacks,
    ) -> Result<(), String> {
        let mut running = self.running.lock().unwrap();
        if running.contains_key(&run_id) {
            return Err(format!("plugin '{run_id}' is already running"));
        }
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_for_thread = stop_flag.clone();
        let self_for_cleanup = self.clone();
        let id_for_cleanup = run_id.clone();
        let handle = thread::spawn(move || {
            run_on_thread(
                stream_id,
                kind,
                code,
                event_bus,
                callbacks,
                stop_flag_for_thread,
            );
            self_for_cleanup
                .running
                .lock()
                .unwrap()
                .remove(&id_for_cleanup);
        });
        running.insert(run_id, RunningPlugin { stop_flag, handle });
        Ok(())
    }

    pub fn stop(&self, run_id: &str) -> Result<(), String> {
        let rp = self
            .running
            .lock()
            .unwrap()
            .remove(run_id)
            .ok_or_else(|| format!("plugin '{run_id}' is not running"))?;
        rp.stop_flag.store(true, Ordering::Relaxed);
        let _ = rp.handle.join();
        Ok(())
    }
}

fn run_on_thread(
    stream_id: String,
    kind: PluginKind,
    code: String,
    event_bus: EventBus,
    callbacks: PluginCallbacks,
    stop_flag: Arc<AtomicBool>,
) {
    let lua = Lua::new();
    if let Err(e) = lua.load(&code).exec() {
        (callbacks.on_error)(e.to_string());
        (callbacks.on_done)();
        return;
    }

    let entry_point = match kind {
        PluginKind::Decoder => "decode",
        PluginKind::PlotterParser => "parse",
    };
    if lua.globals().get::<mlua::Function>(entry_point).is_err() {
        (callbacks.on_error)(format!("plugin does not define a `{entry_point}` function"));
        (callbacks.on_done)();
        return;
    }

    let event_rx = event_bus.subscribe();
    let mut pending = Vec::new();
    let poll = std::time::Duration::from_millis(POLL_INTERVAL_MS);

    while !stop_flag.load(Ordering::Relaxed) {
        match event_rx.recv_timeout(poll) {
            Ok(Event::DataReceived {
                stream_id: sid,
                data,
            }) if sid == stream_id => {
                for line in extract_lines(&mut pending, &data) {
                    let Ok(entry) = lua.globals().get::<mlua::Function>(entry_point) else {
                        continue;
                    };
                    match entry.call::<mlua::Table>(line) {
                        Ok(table) => match kind {
                            PluginKind::Decoder => (callbacks.on_decoded)(table_to_fields(&table)),
                            PluginKind::PlotterParser => {
                                for (channel, value) in table_to_numeric_pairs(&table) {
                                    (callbacks.on_plot)(channel, value);
                                }
                            }
                        },
                        Err(e) => (callbacks.on_error)(e.to_string()),
                    }
                    if stop_flag.load(Ordering::Relaxed) {
                        break;
                    }
                }
            }
            Ok(_) => {}
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    (callbacks.on_done)();
}

fn table_to_fields(table: &mlua::Table) -> HashMap<String, String> {
    table
        .pairs::<String, Value>()
        .filter_map(|pair| pair.ok())
        .map(|(k, v)| (k, stringify(&v)))
        .collect()
}

fn table_to_numeric_pairs(table: &mlua::Table) -> Vec<(String, f64)> {
    table
        .pairs::<String, Value>()
        .filter_map(|pair| pair.ok())
        .filter_map(|(k, v)| match v {
            Value::Integer(i) => Some((k, i as f64)),
            Value::Number(n) => Some((k, n)),
            _ => None,
        })
        .collect()
}

fn stringify(value: &Value) -> String {
    match value {
        Value::Nil => "nil".to_string(),
        Value::Boolean(b) => b.to_string(),
        Value::Integer(i) => i.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.to_string_lossy(),
        other => format!("{other:?}"),
    }
}

/// Splits `incoming` off the end of `pending` into complete lines (split on
/// `\n`, trailing `\r` stripped), leaving any trailing partial line in
/// `pending` for next time. Duplicated from `script::extract_lines` rather
/// than shared — small enough that the coupling isn't worth it, and this
/// module's line concept could plausibly diverge (e.g. binary framing)
/// later without dragging the script engine along.
fn extract_lines(pending: &mut Vec<u8>, incoming: &[u8]) -> Vec<String> {
    pending.extend_from_slice(incoming);
    let mut lines = Vec::new();
    let mut start = 0;
    for i in 0..pending.len() {
        if pending[i] == b'\n' {
            let end = if i > start && pending[i - 1] == b'\r' {
                i - 1
            } else {
                i
            };
            lines.push(String::from_utf8_lossy(&pending[start..end]).into_owned());
            start = i + 1;
        }
    }
    pending.drain(0..start);
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_lines_splits_and_keeps_partial_tail() {
        let mut pending = Vec::new();
        let lines = extract_lines(&mut pending, b"hello\r\nworld\npart");
        assert_eq!(lines, vec!["hello".to_string(), "world".to_string()]);
        assert_eq!(pending, b"part");
    }

    #[test]
    fn table_to_fields_stringifies_values() {
        let lua = Lua::new();
        let table: mlua::Table = lua
            .load("return { a = 'x', b = 42, c = true }")
            .eval()
            .unwrap();
        let fields = table_to_fields(&table);
        assert_eq!(fields.get("a").unwrap(), "x");
        assert_eq!(fields.get("b").unwrap(), "42");
        assert_eq!(fields.get("c").unwrap(), "true");
    }

    #[test]
    fn table_to_numeric_pairs_skips_non_numeric() {
        let lua = Lua::new();
        let table: mlua::Table = lua
            .load("return { temp = 21.5, label = 'x', count = 3 }")
            .eval()
            .unwrap();
        let mut pairs = table_to_numeric_pairs(&table);
        pairs.sort_by_key(|p| p.0.clone());
        assert_eq!(
            pairs,
            vec![("count".to_string(), 3.0), ("temp".to_string(), 21.5)]
        );
    }
}
