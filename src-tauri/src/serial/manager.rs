//! Serial port manager (Tháng 1 M1-T1): registry of open ports keyed by a
//! caller-assigned `id` (independent of the OS port name, so a reconnect can
//! swap the underlying port name transparently), a state machine per port,
//! and a background watcher that detects unplug/replug by VID/PID + serial
//! number rather than by interpreting OS read() errors (which are not
//! reliably distinguishable from transient errors across platforms).
//!
//! This module is deliberately Tauri-free — it only depends on
//! `crate::core`/`serialport` — so it stays usable from a future headless
//! CLI mode (Giai đoạn 3) without changes. The Tauri command wrappers and
//! the 60fps batch-to-frontend emitter live in `lib.rs`, where `AppHandle`
//! is available.

use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::core::data_stream::DataStream;
use crate::core::event_bus::{Event, EventBus};
use crate::core::file_logger::{LogWriter, LogWriterConfig};
use crate::core::serial_stream::{self, SerialConfig, SerialStream, SignalState};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DataBitsDto {
    Five,
    Six,
    Seven,
    Eight,
}

impl From<DataBitsDto> for serialport::DataBits {
    fn from(v: DataBitsDto) -> Self {
        match v {
            DataBitsDto::Five => serialport::DataBits::Five,
            DataBitsDto::Six => serialport::DataBits::Six,
            DataBitsDto::Seven => serialport::DataBits::Seven,
            DataBitsDto::Eight => serialport::DataBits::Eight,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ParityDto {
    None,
    Odd,
    Even,
}

impl From<ParityDto> for serialport::Parity {
    fn from(v: ParityDto) -> Self {
        match v {
            ParityDto::None => serialport::Parity::None,
            ParityDto::Odd => serialport::Parity::Odd,
            ParityDto::Even => serialport::Parity::Even,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StopBitsDto {
    One,
    Two,
}

impl From<StopBitsDto> for serialport::StopBits {
    fn from(v: StopBitsDto) -> Self {
        match v {
            StopBitsDto::One => serialport::StopBits::One,
            StopBitsDto::Two => serialport::StopBits::Two,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FlowControlDto {
    None,
    Software,
    Hardware,
}

impl From<FlowControlDto> for serialport::FlowControl {
    fn from(v: FlowControlDto) -> Self {
        match v {
            FlowControlDto::None => serialport::FlowControl::None,
            FlowControlDto::Software => serialport::FlowControl::Software,
            FlowControlDto::Hardware => serialport::FlowControl::Hardware,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPortRequest {
    /// Caller-assigned id (e.g. a UI tab id) — stable across reconnects even
    /// if the OS reassigns a different port_name to the same physical device.
    pub id: String,
    pub port_name: String,
    pub baud_rate: u32,
    #[serde(default = "default_data_bits")]
    pub data_bits: DataBitsDto,
    #[serde(default = "default_parity")]
    pub parity: ParityDto,
    #[serde(default = "default_stop_bits")]
    pub stop_bits: StopBitsDto,
    #[serde(default = "default_flow_control")]
    pub flow_control: FlowControlDto,
    /// If true, a background watcher reopens this port by VID/PID + serial
    /// number match after it's unplugged and replugged (M1-T1.5).
    #[serde(default)]
    pub auto_reconnect: bool,
    /// RS485 half-duplex direction control — see `SerialConfig::rs485_auto_rts`.
    #[serde(default)]
    pub rs485_auto_rts: bool,
}

fn default_data_bits() -> DataBitsDto {
    DataBitsDto::Eight
}
fn default_parity() -> ParityDto {
    ParityDto::None
}
fn default_stop_bits() -> StopBitsDto {
    StopBitsDto::One
}
fn default_flow_control() -> FlowControlDto {
    FlowControlDto::None
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub port_name: String,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub serial_number: Option<String>,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
}

impl From<serialport::SerialPortInfo> for PortInfo {
    fn from(info: serialport::SerialPortInfo) -> Self {
        match info.port_type {
            serialport::SerialPortType::UsbPort(usb) => PortInfo {
                port_name: info.port_name,
                vid: Some(usb.vid),
                pid: Some(usb.pid),
                serial_number: usb.serial_number,
                manufacturer: usb.manufacturer,
                product: usb.product,
            },
            _ => PortInfo {
                port_name: info.port_name,
                vid: None,
                pid: None,
                serial_number: None,
                manufacturer: None,
                product: None,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PortState {
    Open,
    Error { message: String },
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalStateDto {
    pub cts: bool,
    pub dsr: bool,
    pub ri: bool,
    pub cd: bool,
}

impl From<SignalState> for SignalStateDto {
    fn from(s: SignalState) -> Self {
        Self {
            cts: s.cts,
            dsr: s.dsr,
            ri: s.ri,
            cd: s.cd,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct UsbId {
    vid: u16,
    pid: u16,
    serial_number: Option<String>,
}

fn usb_id_of(info: &serialport::SerialPortInfo) -> Option<UsbId> {
    match &info.port_type {
        serialport::SerialPortType::UsbPort(usb) => Some(UsbId {
            vid: usb.vid,
            pid: usb.pid,
            serial_number: usb.serial_number.clone(),
        }),
        _ => None,
    }
}

struct ManagedPort {
    config: SerialConfig,
    stream: SerialStream,
    state: PortState,
    usb_id: Option<UsbId>,
    auto_reconnect: bool,
    logger: Option<LogWriter>,
}

// Each port gets its own lock instead of every port sharing one map-wide
// Mutex. The outer `ports` lock now only ever guards the map's *shape*
// (which ids exist) and is held just long enough to look up or clone an
// Arc handle — never across a slow per-port operation (an OS open/close
// call, a disk write for logging). That's a structural guarantee rather
// than a convention every method has to individually remember: a slow or
// flaky device can only ever contend its own lock, so it can no longer
// stall drain_open_ports() (needed every 16ms by every other open port's
// live data) or any other port's write/close/logging.
type SharedPort = Arc<Mutex<ManagedPort>>;

pub struct PortManager {
    ports: Mutex<HashMap<String, SharedPort>>,
    event_bus: EventBus,
}

impl PortManager {
    pub fn new(event_bus: EventBus) -> Self {
        Self {
            ports: Mutex::new(HashMap::new()),
            event_bus,
        }
    }

    pub fn list_available_ports() -> io::Result<Vec<PortInfo>> {
        Ok(serial_stream::list_ports()?
            .into_iter()
            .map(PortInfo::from)
            .collect())
    }

    /// Snapshot of `(id, port handle)` pairs, taken under the outer lock
    /// just long enough to clone the Arcs — never held while touching an
    /// individual port afterward.
    fn snapshot(&self) -> Vec<(String, SharedPort)> {
        self.ports
            .lock()
            .unwrap()
            .iter()
            .map(|(id, port)| (id.clone(), port.clone()))
            .collect()
    }

    fn get(&self, id: &str) -> Option<SharedPort> {
        self.ports.lock().unwrap().get(id).cloned()
    }

    pub fn open(&self, req: OpenPortRequest) -> Result<(), String> {
        {
            let ports = self.ports.lock().unwrap();
            if ports.contains_key(&req.id) {
                return Err(format!("port id '{}' is already open", req.id));
            }
        }

        // list_ports() (a full OS port enumeration) and stream.open() (the
        // actual driver open call) can both be slow. Neither touches the
        // ports map, so they must run with no lock held.
        let usb_id = serial_stream::list_ports()
            .ok()
            .and_then(|list| list.into_iter().find(|p| p.port_name == req.port_name))
            .and_then(|p| usb_id_of(&p));

        let mut config = SerialConfig::new(&req.port_name, req.baud_rate);
        config.data_bits = req.data_bits.into();
        config.parity = req.parity.into();
        config.stop_bits = req.stop_bits.into();
        config.flow_control = req.flow_control.into();
        config.rs485_auto_rts = req.rs485_auto_rts;

        let mut stream = SerialStream::new(config.clone());
        match stream.open() {
            Ok(()) => {
                let mut ports = self.ports.lock().unwrap();
                if ports.contains_key(&req.id) {
                    // Raced with another open() of the same id while we were
                    // opening the device with no lock held; close what we
                    // just opened and preserve the original "already open"
                    // error instead of clobbering the winner's entry.
                    let _ = stream.close();
                    return Err(format!("port id '{}' is already open", req.id));
                }
                ports.insert(
                    req.id.clone(),
                    Arc::new(Mutex::new(ManagedPort {
                        config,
                        stream,
                        state: PortState::Open,
                        usb_id,
                        auto_reconnect: req.auto_reconnect,
                        logger: None,
                    })),
                );
                self.event_bus
                    .publish(Event::PortOpened { stream_id: req.id });
                Ok(())
            }
            Err(e) => {
                // The OS error alone ("The system cannot find the file
                // specified.") doesn't say which port failed — prefix it,
                // matching the message shape esp32.rs::connect() already uses.
                let message = format!("failed to open {}: {e}", req.port_name);
                self.event_bus.publish(Event::Error {
                    stream_id: req.id,
                    message: message.clone(),
                });
                Err(message)
            }
        }
    }

    pub fn close(&self, id: &str) -> Result<(), String> {
        let port = self.ports.lock().unwrap().remove(id);
        match port {
            Some(port) => {
                port.lock().unwrap().stream.close().ok();
                self.event_bus.publish(Event::PortClosed {
                    stream_id: id.to_string(),
                });
                Ok(())
            }
            None => Err(format!("port id '{id}' not found")),
        }
    }

    /// Closes every currently tracked port — called on app shutdown so
    /// serial handles are released deterministically instead of leaving it
    /// to the OS to clean up whenever the process actually terminates.
    pub fn close_all(&self) {
        let ports: Vec<(String, SharedPort)> = self.ports.lock().unwrap().drain().collect();
        for (id, port) in ports {
            port.lock().unwrap().stream.close().ok();
            self.event_bus.publish(Event::PortClosed { stream_id: id });
        }
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let port = self
            .get(id)
            .ok_or_else(|| format!("port id '{id}' not found"))?;
        let mut mp = port.lock().unwrap();
        if !matches!(mp.state, PortState::Open) {
            return Err(format!("port id '{id}' is not open"));
        }
        mp.stream.write(data).map_err(|e| e.to_string())
    }

    pub fn set_dtr(&self, id: &str, level: bool) -> Result<(), String> {
        let port = self
            .get(id)
            .ok_or_else(|| format!("port id '{id}' not found"))?;
        let mut mp = port.lock().unwrap();
        if !matches!(mp.state, PortState::Open) {
            return Err(format!("port id '{id}' is not open"));
        }
        mp.stream.set_dtr(level).map_err(|e| e.to_string())
    }

    pub fn set_rts(&self, id: &str, level: bool) -> Result<(), String> {
        let port = self
            .get(id)
            .ok_or_else(|| format!("port id '{id}' not found"))?;
        let mut mp = port.lock().unwrap();
        if !matches!(mp.state, PortState::Open) {
            return Err(format!("port id '{id}' is not open"));
        }
        mp.stream.set_rts(level).map_err(|e| e.to_string())
    }

    pub fn read_signals(&self, id: &str) -> Result<SignalStateDto, String> {
        let port = self
            .get(id)
            .ok_or_else(|| format!("port id '{id}' not found"))?;
        let mut mp = port.lock().unwrap();
        if !matches!(mp.state, PortState::Open) {
            return Err(format!("port id '{id}' is not open"));
        }
        mp.stream
            .read_signals()
            .map(SignalStateDto::from)
            .map_err(|e| e.to_string())
    }

    pub fn start_logging(
        &self,
        id: &str,
        directory: PathBuf,
        max_bytes_per_file: u64,
    ) -> Result<(), String> {
        let port = self
            .get(id)
            .ok_or_else(|| format!("port id '{id}' not found"))?;
        let config = LogWriterConfig::new(directory, id, max_bytes_per_file);
        let writer = LogWriter::create(config).map_err(|e| e.to_string())?;
        port.lock().unwrap().logger = Some(writer);
        Ok(())
    }

    pub fn stop_logging(&self, id: &str) -> Result<(), String> {
        let port = self
            .get(id)
            .ok_or_else(|| format!("port id '{id}' not found"))?;
        port.lock().unwrap().logger = None;
        Ok(())
    }

    pub fn is_logging(&self, id: &str) -> bool {
        self.get(id)
            .is_some_and(|port| port.lock().unwrap().logger.is_some())
    }

    pub fn states(&self) -> Vec<(String, PortState)> {
        self.snapshot()
            .into_iter()
            .map(|(id, port)| (id, port.lock().unwrap().state.clone()))
            .collect()
    }

    /// Drains buffered bytes for every currently open port. Called on a
    /// ~16ms tick by the batch emitter (M1-T1.6) — never per-byte. Each
    /// port is locked individually (see `SharedPort`), so one port's
    /// logging disk write (or any other per-port slowness) can't delay
    /// draining any other port on the same tick.
    pub fn drain_open_ports(&self) -> Vec<(String, Vec<u8>)> {
        self.snapshot()
            .into_iter()
            .filter_map(|(id, port)| {
                let mut mp = port.lock().unwrap();
                if !matches!(mp.state, PortState::Open) {
                    return None;
                }
                let bytes = mp.stream.read().unwrap_or_default();
                if bytes.is_empty() {
                    return None;
                }
                if let Some(logger) = mp.logger.as_mut() {
                    if let Err(e) = logger.write_batch(&bytes) {
                        eprintln!("log write failed for port '{id}': {e}");
                    }
                }
                Some((id, bytes))
            })
            .collect()
    }
}

/// Background watcher (M1-T1.5): every second, checks auto-reconnect ports
/// against the live port list by VID/PID + serial number (not by port_name,
/// which the OS may reassign on replug) — marks disconnected ports as
/// `Error`, and reopens them once their USB id reappears.
pub fn spawn_reconnect_watcher(manager: Arc<PortManager>) -> thread::JoinHandle<()> {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        let Ok(available) = serial_stream::list_ports() else {
            continue;
        };
        let available_usb_ids: Vec<UsbId> = available.iter().filter_map(usb_id_of).collect();

        // Phase 1: cheap bookkeeping, one port lock at a time — never the
        // whole map at once, so one port's check can't delay another's.
        // Detecting a lost device and closing its (now-dead) stream is fast,
        // bounded by the reader thread's read timeout. Reopening a device is
        // not: SerialStream::open() can block for a while, so it happens in
        // phase 2, with no port lock held at all.
        let mut to_reopen: Vec<(String, SerialConfig)> = Vec::new();
        for (id, port) in manager.snapshot() {
            let mut mp = port.lock().unwrap();
            if !mp.auto_reconnect {
                continue;
            }
            match &mp.state {
                PortState::Open => {
                    if let Some(usb_id) = &mp.usb_id {
                        if !available_usb_ids.contains(usb_id) {
                            let _ = mp.stream.close();
                            let message = "device disconnected".to_string();
                            mp.state = PortState::Error {
                                message: message.clone(),
                            };
                            manager.event_bus.publish(Event::Error {
                                stream_id: id.clone(),
                                message,
                            });
                        }
                    }
                }
                PortState::Error { .. } => {
                    let Some(usb_id) = &mp.usb_id else { continue };
                    if let Some(found) = available
                        .iter()
                        .find(|p| usb_id_of(p).as_ref() == Some(usb_id))
                    {
                        mp.config.port_name = found.port_name.clone();
                        to_reopen.push((id.clone(), mp.config.clone()));
                    }
                }
            }
        }

        // Phase 2: the actual reopen attempts, with no lock held, so a slow
        // or flaky device doesn't stall drain_open_ports() or any other port.
        for (id, config) in to_reopen {
            let mut new_stream = SerialStream::new(config);
            if new_stream.open().is_ok() {
                if let Some(port) = manager.get(&id) {
                    let mut mp = port.lock().unwrap();
                    mp.stream = new_stream;
                    mp.state = PortState::Open;
                }
                manager
                    .event_bus
                    .publish(Event::PortOpened { stream_id: id });
            }
        }
    })
}

/// Background watcher: every 1.5s, diffs the live USB serial port list
/// against the previous poll (by VID/PID/serial, same identity rule as
/// `spawn_reconnect_watcher`) and publishes `UsbPlugged`/`UsbUnplugged` for
/// whatever changed. Unlike the reconnect watcher, this doesn't touch
/// `PortManager` at all — it's about physical USB presence, not open
/// streams — so it also covers devices the app has never opened, which is
/// what drives the port list auto-refresh and "auto-flash on plug".
pub fn spawn_hotplug_watcher(event_bus: EventBus) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut known: Vec<(UsbId, String)> = serial_stream::list_ports()
            .map(|ports| {
                ports
                    .iter()
                    .filter_map(|p| usb_id_of(p).map(|id| (id, p.port_name.clone())))
                    .collect()
            })
            .unwrap_or_default();

        loop {
            thread::sleep(Duration::from_millis(1500));
            let Ok(available) = serial_stream::list_ports() else {
                continue;
            };
            let current: Vec<(UsbId, serialport::SerialPortInfo)> = available
                .into_iter()
                .filter_map(|p| usb_id_of(&p).map(|id| (id, p)))
                .collect();

            for (id, info) in &current {
                if !known.iter().any(|(kid, _)| kid == id) {
                    let port_info = PortInfo::from(info.clone());
                    event_bus.publish(Event::UsbPlugged {
                        port_name: port_info.port_name,
                        vid: port_info.vid,
                        pid: port_info.pid,
                        serial_number: port_info.serial_number,
                        manufacturer: port_info.manufacturer,
                        product: port_info.product,
                    });
                }
            }
            for (id, port_name) in &known {
                if !current.iter().any(|(cid, _)| cid == id) {
                    event_bus.publish(Event::UsbUnplugged {
                        port_name: port_name.clone(),
                    });
                }
            }
            known = current
                .into_iter()
                .map(|(id, info)| (id, info.port_name))
                .collect();
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_to_unknown_port_errors() {
        let manager = PortManager::new(EventBus::new());
        let err = manager.write("nope", b"hi").unwrap_err();
        assert!(err.contains("not found"));
    }

    #[test]
    fn close_unknown_port_errors() {
        let manager = PortManager::new(EventBus::new());
        let err = manager.close("nope").unwrap_err();
        assert!(err.contains("not found"));
    }

    #[test]
    fn states_empty_when_nothing_open() {
        let manager = PortManager::new(EventBus::new());
        assert!(manager.states().is_empty());
    }

    #[test]
    fn close_all_on_empty_manager_does_nothing() {
        let manager = PortManager::new(EventBus::new());
        manager.close_all();
        assert!(manager.states().is_empty());
    }

    #[test]
    fn port_info_from_non_usb_port_has_no_usb_fields() {
        let info = serialport::SerialPortInfo {
            port_name: "COM1".to_string(),
            port_type: serialport::SerialPortType::PciPort,
        };
        let port_info = PortInfo::from(info);
        assert_eq!(port_info.port_name, "COM1");
        assert!(port_info.vid.is_none());
    }

    #[test]
    fn port_info_from_usb_port_carries_vid_pid() {
        let info = serialport::SerialPortInfo {
            port_name: "COM5".to_string(),
            port_type: serialport::SerialPortType::UsbPort(serialport::UsbPortInfo {
                vid: 0x10c4,
                pid: 0xea60,
                serial_number: Some("ABC123".to_string()),
                manufacturer: Some("Silicon Labs".to_string()),
                product: Some("CP2102".to_string()),
                interface: None,
            }),
        };
        let port_info = PortInfo::from(info);
        assert_eq!(port_info.vid, Some(0x10c4));
        assert_eq!(port_info.pid, Some(0xea60));
        assert_eq!(port_info.serial_number.as_deref(), Some("ABC123"));
    }
}
