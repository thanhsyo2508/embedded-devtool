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

pub struct PortManager {
    ports: Mutex<HashMap<String, ManagedPort>>,
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

    pub fn open(&self, req: OpenPortRequest) -> Result<(), String> {
        let mut ports = self.ports.lock().unwrap();
        if ports.contains_key(&req.id) {
            return Err(format!("port id '{}' is already open", req.id));
        }

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
                ports.insert(
                    req.id.clone(),
                    ManagedPort {
                        config,
                        stream,
                        state: PortState::Open,
                        usb_id,
                        auto_reconnect: req.auto_reconnect,
                        logger: None,
                    },
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
        let mut ports = self.ports.lock().unwrap();
        match ports.remove(id) {
            Some(mut mp) => {
                let _ = mp.stream.close();
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
        let mut ports = self.ports.lock().unwrap();
        for (id, mut mp) in ports.drain() {
            let _ = mp.stream.close();
            self.event_bus.publish(Event::PortClosed { stream_id: id });
        }
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut ports = self.ports.lock().unwrap();
        match ports.get_mut(id) {
            Some(mp) if matches!(mp.state, PortState::Open) => {
                mp.stream.write(data).map_err(|e| e.to_string())
            }
            Some(_) => Err(format!("port id '{id}' is not open")),
            None => Err(format!("port id '{id}' not found")),
        }
    }

    pub fn set_dtr(&self, id: &str, level: bool) -> Result<(), String> {
        let mut ports = self.ports.lock().unwrap();
        match ports.get_mut(id) {
            Some(mp) if matches!(mp.state, PortState::Open) => {
                mp.stream.set_dtr(level).map_err(|e| e.to_string())
            }
            Some(_) => Err(format!("port id '{id}' is not open")),
            None => Err(format!("port id '{id}' not found")),
        }
    }

    pub fn set_rts(&self, id: &str, level: bool) -> Result<(), String> {
        let mut ports = self.ports.lock().unwrap();
        match ports.get_mut(id) {
            Some(mp) if matches!(mp.state, PortState::Open) => {
                mp.stream.set_rts(level).map_err(|e| e.to_string())
            }
            Some(_) => Err(format!("port id '{id}' is not open")),
            None => Err(format!("port id '{id}' not found")),
        }
    }

    pub fn read_signals(&self, id: &str) -> Result<SignalStateDto, String> {
        let mut ports = self.ports.lock().unwrap();
        match ports.get_mut(id) {
            Some(mp) if matches!(mp.state, PortState::Open) => mp
                .stream
                .read_signals()
                .map(SignalStateDto::from)
                .map_err(|e| e.to_string()),
            Some(_) => Err(format!("port id '{id}' is not open")),
            None => Err(format!("port id '{id}' not found")),
        }
    }

    pub fn start_logging(
        &self,
        id: &str,
        directory: PathBuf,
        max_bytes_per_file: u64,
    ) -> Result<(), String> {
        let mut ports = self.ports.lock().unwrap();
        let mp = ports
            .get_mut(id)
            .ok_or_else(|| format!("port id '{id}' not found"))?;
        let config = LogWriterConfig::new(directory, id, max_bytes_per_file);
        let writer = LogWriter::create(config).map_err(|e| e.to_string())?;
        mp.logger = Some(writer);
        Ok(())
    }

    pub fn stop_logging(&self, id: &str) -> Result<(), String> {
        let mut ports = self.ports.lock().unwrap();
        let mp = ports
            .get_mut(id)
            .ok_or_else(|| format!("port id '{id}' not found"))?;
        mp.logger = None;
        Ok(())
    }

    pub fn is_logging(&self, id: &str) -> bool {
        self.ports
            .lock()
            .unwrap()
            .get(id)
            .is_some_and(|mp| mp.logger.is_some())
    }

    pub fn states(&self) -> Vec<(String, PortState)> {
        self.ports
            .lock()
            .unwrap()
            .iter()
            .map(|(id, mp)| (id.clone(), mp.state.clone()))
            .collect()
    }

    /// Drains buffered bytes for every currently open port. Called on a
    /// ~16ms tick by the batch emitter (M1-T1.6) — never per-byte.
    pub fn drain_open_ports(&self) -> Vec<(String, Vec<u8>)> {
        self.ports
            .lock()
            .unwrap()
            .iter_mut()
            .filter(|(_, mp)| matches!(mp.state, PortState::Open))
            .filter_map(|(id, mp)| {
                let bytes = mp.stream.read().unwrap_or_default();
                if bytes.is_empty() {
                    return None;
                }
                if let Some(logger) = mp.logger.as_mut() {
                    if let Err(e) = logger.write_batch(&bytes) {
                        eprintln!("log write failed for port '{id}': {e}");
                    }
                }
                Some((id.clone(), bytes))
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

        let mut ports = manager.ports.lock().unwrap();
        for (id, mp) in ports.iter_mut() {
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
                        let mut new_stream = SerialStream::new(mp.config.clone());
                        if new_stream.open().is_ok() {
                            mp.stream = new_stream;
                            mp.state = PortState::Open;
                            manager.event_bus.publish(Event::PortOpened {
                                stream_id: id.clone(),
                            });
                        }
                    }
                }
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
