//! Lua scripting engine (Tháng 5): each running script gets a dedicated OS
//! thread with its own `mlua::Lua` instance, used exclusively from that one
//! thread — no `Send` bound is needed on the Lua state itself, only on the
//! handful of values moved into the thread closure. A script attaches to
//! one serial stream by id and receives its lines through the same
//! `EventBus` the rest of the app already publishes to (ADR-003), so no new
//! plumbing was needed in `PortManager`.
//!
//! This is a convenience sandbox for scripts the user writes themselves —
//! it removes `os`/`io`/`require`/`load`, caps any single callback's
//! running time, and can be force-stopped mid-loop — not a hardened
//! boundary against deliberately malicious code, which is out of scope for
//! automating your own serial workflow.
//!
//! Tauri-free like the rest of `core`/`serial` (see `serial::manager`'s
//! module doc): `lib.rs` supplies the log/alert/plot/error/done callbacks
//! that actually emit to the frontend, mirroring how `flash::esp32` takes a
//! plain progress callback instead of depending on `AppHandle` directly.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crossbeam_channel::RecvTimeoutError;
use mlua::{Function, HookTriggers, Lua, Value, VmState};

use crate::core::event_bus::{Event, EventBus};
use crate::serial::PortManager;

const MAX_CALLBACK_MS: u64 = 2000;
const POLL_INTERVAL_MS: u64 = 200;
/// How often (in VM instructions) the debug hook below gets a chance to
/// check the deadline/stop flag — small enough to interrupt a tight
/// infinite loop within a fraction of a second, large enough not to
/// meaningfully slow down normal scripts.
const INSTRUCTION_HOOK_INTERVAL: u32 = 10_000;

pub struct ScriptCallbacks {
    pub on_log: Arc<dyn Fn(String) + Send + Sync>,
    pub on_alert: Arc<dyn Fn(String) + Send + Sync>,
    pub on_plot: Arc<dyn Fn(String, f64) + Send + Sync>,
    pub on_error: Arc<dyn Fn(String) + Send + Sync>,
    pub on_done: Arc<dyn Fn() + Send + Sync>,
}

struct RunningScript {
    stop_flag: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

#[derive(Default)]
pub struct ScriptManager {
    running: Mutex<HashMap<String, RunningScript>>,
}

impl ScriptManager {
    pub fn new() -> Self {
        Self::default()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn run(
        self: &Arc<Self>,
        manager: Arc<PortManager>,
        event_bus: EventBus,
        script_id: String,
        stream_id: String,
        code: String,
        callbacks: ScriptCallbacks,
    ) -> Result<(), String> {
        let mut running = self.running.lock().unwrap();
        if running.contains_key(&script_id) {
            return Err(format!("script '{script_id}' is already running"));
        }
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_for_thread = stop_flag.clone();
        let self_for_cleanup = self.clone();
        let id_for_cleanup = script_id.clone();
        let handle = thread::spawn(move || {
            run_on_thread(
                manager,
                event_bus,
                stream_id,
                code,
                callbacks,
                stop_flag_for_thread,
            );
            self_for_cleanup
                .running
                .lock()
                .unwrap()
                .remove(&id_for_cleanup);
        });
        running.insert(script_id, RunningScript { stop_flag, handle });
        Ok(())
    }

    pub fn stop(&self, script_id: &str) -> Result<(), String> {
        let rs = self
            .running
            .lock()
            .unwrap()
            .remove(script_id)
            .ok_or_else(|| format!("script '{script_id}' is not running"))?;
        rs.stop_flag.store(true, Ordering::Relaxed);
        let _ = rs.handle.join();
        Ok(())
    }
}

type TimerEntry = (Instant, Duration, Function);

fn run_on_thread(
    manager: Arc<PortManager>,
    event_bus: EventBus,
    stream_id: String,
    code: String,
    callbacks: ScriptCallbacks,
    stop_flag: Arc<AtomicBool>,
) {
    let lua = Lua::new();
    let deadline = Rc::new(Cell::new(
        Instant::now() + Duration::from_millis(MAX_CALLBACK_MS),
    ));
    let timers: Rc<RefCell<Vec<TimerEntry>>> = Rc::new(RefCell::new(Vec::new()));

    let stop_flag_for_hook = stop_flag.clone();
    let deadline_for_hook = deadline.clone();
    lua.set_hook(
        HookTriggers::default().every_nth_instruction(INSTRUCTION_HOOK_INTERVAL),
        move |_, _| {
            if stop_flag_for_hook.load(Ordering::Relaxed) {
                return Err(mlua::Error::RuntimeError("script stopped".into()));
            }
            if Instant::now() > deadline_for_hook.get() {
                return Err(mlua::Error::RuntimeError(format!(
                    "callback exceeded {MAX_CALLBACK_MS}ms — check for an infinite loop"
                )));
            }
            Ok(VmState::Continue)
        },
    );

    if let Err(e) = bind_globals(&lua, &manager, &stream_id, &callbacks, &event_bus, &timers) {
        (callbacks.on_error)(e.to_string());
        (callbacks.on_done)();
        return;
    }

    let reset_deadline = || deadline.set(Instant::now() + Duration::from_millis(MAX_CALLBACK_MS));

    reset_deadline();
    if let Err(e) = lua.load(&code).exec() {
        (callbacks.on_error)(e.to_string());
        (callbacks.on_done)();
        return;
    }

    let event_rx = event_bus.subscribe();
    let mut pending = Vec::new();

    while !stop_flag.load(Ordering::Relaxed) {
        let wait = timers
            .borrow()
            .iter()
            .map(|(next, _, _)| next.saturating_duration_since(Instant::now()))
            .min()
            .unwrap_or(Duration::from_millis(POLL_INTERVAL_MS))
            .min(Duration::from_millis(POLL_INTERVAL_MS));

        match event_rx.recv_timeout(wait) {
            Ok(Event::DataReceived {
                stream_id: sid,
                data,
            }) if sid == stream_id => {
                for line in extract_lines(&mut pending, &data) {
                    reset_deadline();
                    if let Ok(on_data) = lua.globals().get::<Function>("on_data") {
                        if let Err(e) = on_data.call::<()>(line) {
                            (callbacks.on_error)(e.to_string());
                        }
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

        let now = Instant::now();
        let due: Vec<usize> = timers
            .borrow()
            .iter()
            .enumerate()
            .filter(|(_, (next, _, _))| now >= *next)
            .map(|(i, _)| i)
            .collect();
        for i in due {
            let f = timers.borrow()[i].2.clone();
            reset_deadline();
            if let Err(e) = f.call::<()>(()) {
                (callbacks.on_error)(e.to_string());
            }
            if let Some(entry) = timers.borrow_mut().get_mut(i) {
                entry.0 = now + entry.1;
            }
        }
    }

    (callbacks.on_done)();
}

#[allow(clippy::too_many_arguments)]
fn bind_globals(
    lua: &Lua,
    manager: &Arc<PortManager>,
    stream_id: &str,
    callbacks: &ScriptCallbacks,
    event_bus: &EventBus,
    timers: &Rc<RefCell<Vec<TimerEntry>>>,
) -> mlua::Result<()> {
    let globals = lua.globals();

    // Removes the parts of the standard library that would let a script
    // touch the filesystem or OS process directly, or load more code at
    // runtime — string/table/math/pairs/pcall/etc. all stay available.
    for name in [
        "os", "io", "require", "dofile", "loadfile", "load", "package", "debug",
    ] {
        globals.set(name, Value::Nil)?;
    }

    let manager_send = manager.clone();
    let stream_send = stream_id.to_string();
    globals.set(
        "send",
        lua.create_function(move |_, text: String| {
            manager_send
                .write(&stream_send, text.as_bytes())
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;

    let manager_hex = manager.clone();
    let stream_hex = stream_id.to_string();
    globals.set(
        "send_hex",
        lua.create_function(move |_, hex: String| {
            let bytes = parse_hex(&hex).map_err(mlua::Error::RuntimeError)?;
            manager_hex
                .write(&stream_hex, &bytes)
                .map_err(mlua::Error::RuntimeError)
        })?,
    )?;

    let on_log = callbacks.on_log.clone();
    globals.set(
        "log",
        lua.create_function(move |_, value: Value| {
            on_log(stringify(&value));
            Ok(())
        })?,
    )?;

    let on_alert = callbacks.on_alert.clone();
    globals.set(
        "alert",
        lua.create_function(move |_, value: Value| {
            on_alert(stringify(&value));
            Ok(())
        })?,
    )?;

    let on_plot = callbacks.on_plot.clone();
    globals.set(
        "plot",
        lua.create_function(move |_, (channel, value): (String, f64)| {
            on_plot(channel, value);
            Ok(())
        })?,
    )?;

    let timers_for_fn = timers.clone();
    globals.set(
        "timer",
        lua.create_function(move |_, (interval_ms, f): (u64, Function)| {
            let interval = Duration::from_millis(interval_ms.max(1));
            timers_for_fn
                .borrow_mut()
                .push((Instant::now() + interval, interval, f));
            Ok(())
        })?,
    )?;

    let event_rx_for_wait = event_bus.subscribe();
    let stream_wait = stream_id.to_string();
    globals.set(
        "wait_for",
        lua.create_function(move |_, (pattern, timeout_ms): (String, u64)| {
            let re = regex::Regex::new(&pattern)
                .map_err(|e| mlua::Error::RuntimeError(e.to_string()))?;
            let deadline = Instant::now() + Duration::from_millis(timeout_ms);
            let mut pending = Vec::new();
            loop {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Ok(None);
                }
                match event_rx_for_wait.recv_timeout(remaining) {
                    Ok(Event::DataReceived {
                        stream_id: sid,
                        data,
                    }) if sid == stream_wait => {
                        for line in extract_lines(&mut pending, &data) {
                            if re.is_match(&line) {
                                return Ok(Some(line));
                            }
                        }
                    }
                    Ok(_) => {}
                    Err(_) => return Ok(None),
                }
            }
        })?,
    )?;

    Ok(())
}

fn parse_hex(input: &str) -> Result<Vec<u8>, String> {
    let cleaned: String = input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != ',')
        .collect();
    if cleaned.is_empty() {
        return Ok(Vec::new());
    }
    if !cleaned.len().is_multiple_of(2) || !cleaned.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid hex string".to_string());
    }
    (0..cleaned.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&cleaned[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

/// Splits `incoming` off the end of `pending` into complete lines (split on
/// `\n`, trailing `\r` stripped), leaving any trailing partial line in
/// `pending` for next time. Deliberately independent of the frontend's
/// per-tab newline-mode setting — scripts get a fixed, simple line concept.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_hex_round_trips() {
        assert_eq!(parse_hex("01 02, FF").unwrap(), vec![0x01, 0x02, 0xFF]);
        assert_eq!(parse_hex("").unwrap(), Vec::<u8>::new());
        assert!(parse_hex("0").is_err());
        assert!(parse_hex("zz").is_err());
    }

    #[test]
    fn extract_lines_splits_and_keeps_partial_tail() {
        let mut pending = Vec::new();
        let lines = extract_lines(&mut pending, b"hello\r\nworld\npart");
        assert_eq!(lines, vec!["hello".to_string(), "world".to_string()]);
        assert_eq!(pending, b"part");
    }
}
