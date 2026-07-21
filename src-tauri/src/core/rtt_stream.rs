//! SWD/RTT `DataStream` implementation: attaches to a debug probe (ST-Link,
//! J-Link, CMSIS-DAP...) via `probe-rs`, streams RTT channel 0 as log text
//! through the same ring-buffer/pump-thread pipeline every other transport
//! uses (so it gets the full Monitor UI — filters, triggers, bookmarks,
//! search — for free), and polls watched global/static variables on the
//! same loop (see `swd::variables` for how those are discovered from an
//! ELF's DWARF info).
//!
//! SWD access to one probe is exclusive, so RTT and variable reads share a
//! single background thread/`Session` rather than each getting their own —
//! there is no way to open two independent sessions against one ST-Link.
//!
//! RTT only works if the target firmware actually initializes an RTT
//! control block (e.g. the `rtt-target` crate, or SEGGER RTT in C) — this
//! is not automatic like UART. When none is found, the stream still opens
//! successfully (so variable watching works on its own) and periodically
//! retries the RTT attach in case the firmware initializes it later.
//!
//! Write is intentionally unsupported: RTT down-channel writes aren't
//! implemented (nobody asked for this side of it), so `write()` returns
//! the same "unsupported" error the `DataStream` trait's own optional
//! methods (publish/subscribe/send_text) use for capabilities a transport
//! doesn't have.

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crossbeam_channel::{unbounded, Receiver, Sender};
use probe_rs::probe::list::Lister;
use probe_rs::rtt::Rtt;
use probe_rs::{MemoryInterface, Permissions, Session};

use super::data_stream::{DataCallback, DataStream};
use super::event_bus::{Event as CoreEvent, EventBus};
use super::ring_buffer::RingBuffer;
use super::stream_pump::spawn_pump_thread;

const RING_BUFFER_CAPACITY: usize = 1 << 20;
/// How often the poll thread reads RTT + watched variables.
const POLL_INTERVAL: Duration = Duration::from_millis(150);
/// Bounds how long `open()` waits for the probe open + session attach —
/// both are synchronous `probe-rs` calls with no timeout of their own, so a
/// wedged/unresponsive probe or an unresponsive target during the attach
/// handshake used to hang `open()` forever. `probe-rs` gives no way to
/// cancel an in-progress attach, so on timeout the attach thread is simply
/// abandoned (detached, not killed) rather than joined — same tradeoff
/// `RttStream::close()`'s doc would otherwise have to explain twice.
const ATTACH_TIMEOUT: Duration = Duration::from_secs(10);
/// Watched-variable reads are capped to this many bytes — enough for any
/// primitive `swd::variables::list_variables` reports, refuses anything
/// larger rather than reading an unbounded amount over SWD per tick.
const MAX_WATCH_SIZE: u8 = 32;

pub struct RttConfig {
    /// Matches `DebugProbeInfo.serial_number` — `None` opens whichever
    /// probe `Lister::list_all()` returns first.
    pub probe_serial: Option<String>,
    /// A probe-rs target name (e.g. "STM32F407VG") — prefix-matched
    /// case-insensitively against probe-rs's built-in chip database, see
    /// `swd::search_chips`.
    pub chip: String,
}

#[derive(Clone)]
struct WatchedVar {
    name: String,
    address: u64,
    size: u8,
}

pub struct RttStream {
    stream_id: String,
    event_bus: EventBus,
    config: RttConfig,
    stop_flag: Arc<AtomicBool>,
    connected: Arc<AtomicBool>,
    poll_thread: Option<JoinHandle<()>>,
    pump_thread: Option<JoinHandle<()>>,
    buffer: Arc<Mutex<RingBuffer>>,
    callbacks: Arc<Mutex<Vec<DataCallback>>>,
    watch: Arc<Mutex<Vec<WatchedVar>>>,
}

impl RttStream {
    pub fn new(stream_id: String, event_bus: EventBus, config: RttConfig) -> Self {
        Self {
            stream_id,
            event_bus,
            config,
            stop_flag: Arc::new(AtomicBool::new(false)),
            connected: Arc::new(AtomicBool::new(false)),
            poll_thread: None,
            pump_thread: None,
            buffer: Arc::new(Mutex::new(RingBuffer::new(RING_BUFFER_CAPACITY))),
            callbacks: Arc::new(Mutex::new(Vec::new())),
            watch: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

fn run_poll_loop(
    mut session: Session,
    stop_flag: Arc<AtomicBool>,
    watch: Arc<Mutex<Vec<WatchedVar>>>,
    tx: Sender<Vec<u8>>,
    stream_id: String,
    event_bus: EventBus,
) {
    let mut rtt: Option<Rtt> = None;
    while !stop_flag.load(Ordering::Relaxed) {
        let mut core = match session.core(0) {
            Ok(core) => core,
            Err(_) => {
                thread::sleep(POLL_INTERVAL);
                continue;
            }
        };

        if rtt.is_none() {
            if let Ok(attached) = Rtt::attach(&mut core) {
                rtt = Some(attached);
                let _ = tx.send(b"[rtt] control block found, log streaming started\n".to_vec());
            }
        }

        if let Some(channel) = rtt.as_mut().and_then(|r| r.up_channels.first_mut()) {
            let mut buf = [0u8; 1024];
            if let Ok(count) = channel.read(&mut core, &mut buf) {
                if count > 0 {
                    let _ = tx.send(buf[..count].to_vec());
                }
            }
        }

        let watched = watch.lock().unwrap().clone();
        for var in watched {
            let mut buf = vec![0u8; var.size as usize];
            if core.read(var.address, &mut buf).is_ok() {
                event_bus.publish(CoreEvent::SwdVariable {
                    stream_id: stream_id.clone(),
                    name: var.name.clone(),
                    bytes: Arc::from(buf),
                });
            }
        }

        drop(core);
        thread::sleep(POLL_INTERVAL);
    }
}

impl DataStream for RttStream {
    fn open(&mut self) -> io::Result<()> {
        if self.connected.load(Ordering::SeqCst) {
            return Ok(());
        }

        let probes = Lister::new().list_all();
        let probe_info = match &self.config.probe_serial {
            Some(serial) => probes
                .into_iter()
                .find(|p| p.serial_number.as_deref() == Some(serial.as_str())),
            None => probes.into_iter().next(),
        }
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no debug probe found"))?;

        let (tx, rx): (Sender<Vec<u8>>, Receiver<Vec<u8>>) = unbounded();
        let (ready_tx, ready_rx) = unbounded::<Result<(), String>>();
        self.stop_flag.store(false, Ordering::SeqCst);
        let stop_flag = self.stop_flag.clone();
        let watch = self.watch.clone();
        let stream_id = self.stream_id.clone();
        let event_bus = self.event_bus.clone();
        let chip = self.config.chip.clone();

        let handle = thread::spawn(move || {
            let probe = match probe_info.open() {
                Ok(p) => p,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("failed to open probe: {e}")));
                    return;
                }
            };
            let session = match probe.attach(chip.as_str(), Permissions::default()) {
                Ok(s) => s,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("failed to attach to {chip}: {e}")));
                    return;
                }
            };
            let _ = ready_tx.send(Ok(()));
            run_poll_loop(session, stop_flag, watch, tx, stream_id, event_bus);
        });

        match ready_rx.recv_timeout(ATTACH_TIMEOUT) {
            Ok(Ok(())) => {
                self.poll_thread = Some(handle);
            }
            Ok(Err(message)) => {
                let _ = handle.join();
                return Err(io::Error::other(message));
            }
            Err(_) => {
                drop(handle);
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "timed out attaching to the debug probe",
                ));
            }
        }

        self.pump_thread = Some(spawn_pump_thread(
            rx,
            self.buffer.clone(),
            self.callbacks.clone(),
        ));
        self.connected.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn close(&mut self) -> io::Result<()> {
        self.stop_flag.store(true, Ordering::SeqCst);
        self.connected.store(false, Ordering::SeqCst);
        if let Some(handle) = self.poll_thread.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.pump_thread.take() {
            let _ = handle.join();
        }
        Ok(())
    }

    fn read(&mut self) -> io::Result<Vec<u8>> {
        Ok(self.buffer.lock().unwrap().drain_all())
    }

    fn write(&mut self, _data: &[u8]) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "RTT down-channel writes are not supported",
        ))
    }

    fn on_data(&mut self, callback: DataCallback) {
        self.callbacks.lock().unwrap().push(callback);
    }

    fn watch_variable(&mut self, name: String, address: u64, size: u8) -> io::Result<()> {
        if size == 0 || size > MAX_WATCH_SIZE {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("variable size must be 1..={MAX_WATCH_SIZE} bytes"),
            ));
        }
        let mut watch = self.watch.lock().unwrap();
        watch.retain(|v| v.name != name);
        watch.push(WatchedVar {
            name,
            address,
            size,
        });
        Ok(())
    }

    fn unwatch_variable(&mut self, name: &str) -> io::Result<()> {
        self.watch.lock().unwrap().retain(|v| v.name != name);
        Ok(())
    }

    fn is_open(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
