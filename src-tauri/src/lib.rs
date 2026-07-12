pub mod core;
pub mod flash;
pub mod ftp;
pub mod net;
pub mod plugin;
pub mod restapi;
pub mod script;
pub mod serial;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::core::event_bus::{Event, EventBus, WsFrameKind};
use crate::flash::esp32::{self, ChipInfo, FlashProgress, FlashSegmentReq};
use crate::flash::esp32_ota::{self, OtaProgress};
use crate::flash::partition_table::{self, PartitionEntry};
use crate::flash::profile::{self, FlashProfile};
use crate::flash::stm32::{self, Interface as StmInterface, McuInfo as StmMcuInfo};
use crate::net::NetworkManager;
use crate::script::{ScriptCallbacks, ScriptManager};
use crate::serial::{OpenPortRequest, PortInfo, PortManager, PortState, SignalStateDto};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

#[tauri::command]
fn list_serial_ports() -> Result<Vec<PortInfo>, String> {
    PortManager::list_available_ports().map_err(|e| e.to_string())
}

#[tauri::command]
fn open_serial_port(
    manager: tauri::State<Arc<PortManager>>,
    req: OpenPortRequest,
) -> Result<(), String> {
    manager.open(req)
}

#[tauri::command]
fn close_serial_port(manager: tauri::State<Arc<PortManager>>, id: String) -> Result<(), String> {
    manager.close(&id)
}

#[tauri::command]
fn write_serial_port(
    manager: tauri::State<Arc<PortManager>>,
    id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    manager.write(&id, &data)
}

/// Backs the trigger/action "write to file" action: appends one matched
/// line to a user-chosen file, creating it on first write.
#[tauri::command]
fn append_trigger_log(path: String, line: String) -> Result<(), String> {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())
}

/// Generic save-dialog companions (Tháng 7, plotter CSV/PNG export — but
/// deliberately not plot-specific): the frontend picks a path via the
/// dialog plugin, then hands the contents here. Two commands rather than
/// one bytes command because a large CSV serialized as a JSON number array
/// would be several times its actual size, while text-as-string is ~1x.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

/// Read side of write_text_file — currently only used to load a saved
/// project profile (.edtproj), picked via the same open-dialog pattern as
/// STM32/ESP32's file-open flows.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MdnsServiceDto {
    fullname: String,
    hostname: String,
    port: u16,
    addresses: Vec<String>,
}

/// mDNS/DNS-SD LAN scan (Tháng 6): browses one service type for up to
/// `timeout_ms`, collecting every resolved instance. Self-contained — the
/// daemon lives only for the duration of the scan, so there's no long-lived
/// state to manage. Blocking is fine here: Tauri runs commands off the main
/// thread and the frontend shows a scanning indicator.
#[tauri::command]
fn mdns_scan(service_type: String, timeout_ms: u64) -> Result<Vec<MdnsServiceDto>, String> {
    use std::collections::HashMap;
    use std::time::{Duration, Instant};

    let timeout = Duration::from_millis(timeout_ms.clamp(500, 15_000));
    let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| e.to_string())?;
    let receiver = daemon.browse(&service_type).map_err(|e| e.to_string())?;

    let mut found: HashMap<String, MdnsServiceDto> = HashMap::new();
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match receiver.recv_timeout(remaining) {
            Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) => {
                // Prefer IPv4 for display/connect; fall back to whatever
                // addresses exist (e.g. IPv6-only devices).
                let mut addresses: Vec<String> = info
                    .get_addresses_v4()
                    .iter()
                    .map(|a| a.to_string())
                    .collect();
                if addresses.is_empty() {
                    addresses = info.get_addresses().iter().map(|a| a.to_string()).collect();
                }
                addresses.sort();
                found.insert(
                    info.get_fullname().to_string(),
                    MdnsServiceDto {
                        fullname: info.get_fullname().to_string(),
                        hostname: info.get_hostname().to_string(),
                        port: info.get_port(),
                        addresses,
                    },
                );
            }
            Ok(_) => {}
            Err(_) => break, // timeout or daemon gone — either way, done
        }
    }

    let _ = daemon.stop_browse(&service_type);
    let _ = daemon.shutdown();

    let mut services: Vec<MdnsServiceDto> = found.into_values().collect();
    services.sort_by(|a, b| a.fullname.cmp(&b.fullname));
    Ok(services)
}

/// Prefills the scan UI's CIDR field: opens a UDP socket "connected" to a
/// public address (no packet actually sent — `connect()` on a UDP socket
/// just picks the outbound route) purely to read back which local IPv4
/// interface/subnet the OS would use.
#[tauri::command]
fn detect_local_subnet() -> Result<String, String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.connect("8.8.8.8:80").map_err(|e| e.to_string())?;
    match socket.local_addr().map_err(|e| e.to_string())?.ip() {
        std::net::IpAddr::V4(ip) => {
            let o = ip.octets();
            Ok(format!("{}.{}.{}.0/24", o[0], o[1], o[2]))
        }
        std::net::IpAddr::V6(_) => Err("no local IPv4 address found".to_string()),
    }
}

#[tauri::command]
fn common_scan_ports() -> Vec<(u16, String)> {
    net::scanner::COMMON_PORTS
        .iter()
        .map(|(port, name)| (*port, name.to_string()))
        .collect()
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NetScanHitEvent {
    id: String,
    ip: String,
    port: u16,
    service: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NetScanDoneEvent {
    id: String,
    hosts_scanned: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NetScanHostEvent {
    id: String,
    ip: String,
    mac: Option<String>,
    name: Option<String>,
}

/// LAN scanner (complements `mdns_scan`): sweeps `cidr` and TCP-connects to
/// `ports` (defaults to `COMMON_PORTS` when empty) on every host, streaming
/// each open port back as a "netscan://hit" event as soon as it's found,
/// tagged with the caller-supplied `id` the same way flash/stm32 tag their
/// progress events. CIDR parsing happens synchronously so a typo comes back
/// as an immediate `Err`; the scan itself runs on a background thread since
/// a full /24 can take a few seconds even with concurrent connects.
///
/// Once the port sweep finishes, every host that had at least one open port
/// gets a single "netscan://host" event with its MAC (from the ARP table)
/// and hostname (reverse DNS) — done as a second pass over just the live
/// hosts rather than per-port, since ARP/DNS lookups are far slower than a
/// TCP connect attempt and would otherwise dominate the scan time.
#[tauri::command]
fn start_network_scan(
    app: AppHandle,
    id: String,
    cidr: String,
    ports: Vec<u16>,
    timeout_ms: u64,
) -> Result<(), String> {
    let ips = net::scanner::expand_cidr(&cidr)?;
    let ports = if ports.is_empty() {
        net::scanner::COMMON_PORTS.iter().map(|(p, _)| *p).collect()
    } else {
        ports
    };
    let hosts_scanned = ips.len();

    thread::spawn(move || {
        let live_ips = Arc::new(Mutex::new(std::collections::HashSet::<String>::new()));

        let app_for_hits = app.clone();
        let id_for_hits = id.clone();
        let live_ips_for_hits = live_ips.clone();
        net::scanner::scan_ports(&ips, &ports, timeout_ms, move |hit| {
            live_ips_for_hits.lock().unwrap().insert(hit.ip.clone());
            let _ = app_for_hits.emit(
                "netscan://hit",
                NetScanHitEvent {
                    id: id_for_hits.clone(),
                    ip: hit.ip,
                    port: hit.port,
                    service: hit.service,
                },
            );
        });

        let arp = net::scanner::arp_table();
        for ip in live_ips.lock().unwrap().iter() {
            let mac = arp.get(ip).cloned();
            let name = ip.parse().ok().and_then(net::scanner::reverse_dns);
            let _ = app.emit(
                "netscan://host",
                NetScanHostEvent {
                    id: id.clone(),
                    ip: ip.clone(),
                    mac,
                    name,
                },
            );
        }

        let _ = app.emit("netscan://done", NetScanDoneEvent { id, hosts_scanned });
    });
    Ok(())
}

/// Deep scan (M-extra): sweeps a custom port range on a single already-known
/// IP — the counterpart to `start_network_scan`'s fixed common-port list.
/// Capped at `MAX_DEEP_SCAN_RANGE` ports so a mistaken full 0-65535 request
/// doesn't tie up the worker pool for minutes.
#[tauri::command]
fn start_deep_scan(
    app: AppHandle,
    id: String,
    ip: String,
    port_from: u16,
    port_to: u16,
    timeout_ms: u64,
) -> Result<(), String> {
    const MAX_DEEP_SCAN_RANGE: u32 = 20_000;

    let addr: std::net::Ipv4Addr = ip
        .parse()
        .map_err(|_| format!("invalid IP address: {ip}"))?;
    if port_from > port_to {
        return Err("port range start must be <= end".to_string());
    }
    let range_size = port_to as u32 - port_from as u32 + 1;
    if range_size > MAX_DEEP_SCAN_RANGE {
        return Err(format!(
            "port range too large ({range_size}) — max {MAX_DEEP_SCAN_RANGE}"
        ));
    }
    let ports: Vec<u16> = (port_from..=port_to).collect();

    thread::spawn(move || {
        let app_for_hits = app.clone();
        let id_for_hits = id.clone();
        net::scanner::scan_ports(&[addr], &ports, timeout_ms, move |hit| {
            let _ = app_for_hits.emit(
                "netscan://hit",
                NetScanHitEvent {
                    id: id_for_hits.clone(),
                    ip: hit.ip,
                    port: hit.port,
                    service: hit.service,
                },
            );
        });
        let _ = app.emit(
            "netscan://done",
            NetScanDoneEvent {
                id,
                hosts_scanned: 1,
            },
        );
    });
    Ok(())
}

const LOG_ROTATION_BYTES: u64 = 50 * 1024 * 1024;

/// M1-T2.7: starts writing this port's data to a raw + timestamped log file
/// pair under the app's log directory, rotating each independently once it
/// exceeds `LOG_ROTATION_BYTES`. Returns the directory the files were
/// written into, for display in the UI.
#[tauri::command]
fn start_serial_logging(
    app: AppHandle,
    manager: tauri::State<Arc<PortManager>>,
    id: String,
) -> Result<String, String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    manager.start_logging(&id, dir.clone(), LOG_ROTATION_BYTES)?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn stop_serial_logging(manager: tauri::State<Arc<PortManager>>, id: String) -> Result<(), String> {
    manager.stop_logging(&id)
}

#[tauri::command]
fn is_serial_logging(manager: tauri::State<Arc<PortManager>>, id: String) -> bool {
    manager.is_logging(&id)
}

/// DTR/RTS are commonly toggled together to trigger the classic
/// auto-reset-into-bootloader circuit on ESP32/Arduino boards.
#[tauri::command]
fn set_serial_dtr(
    manager: tauri::State<Arc<PortManager>>,
    id: String,
    level: bool,
) -> Result<(), String> {
    manager.set_dtr(&id, level)
}

#[tauri::command]
fn set_serial_rts(
    manager: tauri::State<Arc<PortManager>>,
    id: String,
    level: bool,
) -> Result<(), String> {
    manager.set_rts(&id, level)
}

/// Holds the OS-level sleep/display-off inhibitor while "keep screen awake"
/// is enabled in settings; dropping the guard (setting this back to `None`)
/// releases it.
struct KeepAwakeState(Mutex<Option<keepawake::KeepAwake>>);

#[tauri::command]
fn set_keep_awake(state: tauri::State<KeepAwakeState>, enabled: bool) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if enabled {
        if guard.is_none() {
            let awake = keepawake::Builder::default()
                .display(true)
                .idle(true)
                .reason("Embedded DevTool serial monitoring")
                .app_name("Embedded DevTool")
                .app_reverse_domain("dev.edt.app")
                .create()
                .map_err(|e| e.to_string())?;
            *guard = Some(awake);
        }
    } else {
        *guard = None;
    }
    Ok(())
}

#[tauri::command]
fn read_serial_signals(
    manager: tauri::State<Arc<PortManager>>,
    id: String,
) -> Result<SignalStateDto, String> {
    manager.read_signals(&id)
}

#[derive(Serialize, Clone)]
struct PortStateEntry {
    id: String,
    #[serde(flatten)]
    state: PortState,
}

#[tauri::command]
fn serial_port_states(manager: tauri::State<Arc<PortManager>>) -> Vec<PortStateEntry> {
    manager
        .states()
        .into_iter()
        .map(|(id, state)| PortStateEntry { id, state })
        .collect()
}

#[derive(Serialize, Clone)]
struct SerialDataBatch {
    id: String,
    data: Vec<u8>,
}

/// Publishes each drained batch onto the shared `EventBus` (so the script
/// engine's `on_data`/`wait_for` see it — this was previously missing
/// entirely, silently leaving those two dead for every transport) and
/// forwards it to the frontend under `tauri_event`. Shared by the serial and
/// network batch emitters below since draining is the only transport-
/// specific part.
fn emit_batches(
    app: &AppHandle,
    event_bus: &EventBus,
    tauri_event: &'static str,
    batches: Vec<(String, Vec<u8>)>,
) {
    for (id, data) in batches {
        event_bus.publish(Event::DataReceived {
            stream_id: id.clone(),
            data: Arc::from(data.as_slice()),
        });
        let _ = app.emit(tauri_event, SerialDataBatch { id, data });
    }
}

/// M1-T1.6: drains every open port's ring buffer on a ~60fps tick and emits
/// one batched event per port with data — never per byte/line.
fn spawn_batch_emitter(app: AppHandle, manager: Arc<PortManager>, event_bus: EventBus) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(16));
        emit_batches(
            &app,
            &event_bus,
            "serial://data",
            manager.drain_open_ports(),
        );
    });
}

#[derive(Serialize, Clone)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum PortLifecycleEvent {
    Opened { stream_id: String },
    Closed { stream_id: String },
    Error { stream_id: String, message: String },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MqttMessageEvent {
    id: String,
    topic: String,
    payload: Vec<u8>,
    qos: u8,
    retain: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UdpDatagramEvent {
    id: String,
    from: String,
    data: Vec<u8>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
enum WsFrameKindDto {
    Text,
    Binary,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WsFrameEvent {
    id: String,
    kind: WsFrameKindDto,
    data: Vec<u8>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UsbPlugEvent {
    port_name: String,
    vid: Option<u16>,
    pid: Option<u16>,
    serial_number: Option<String>,
    manufacturer: Option<String>,
    product: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UsbUnplugEvent {
    port_name: String,
}

/// Forwards port lifecycle events (open/close/error) from the internal
/// EventBus to the frontend. Raw data does not travel this path — see
/// `spawn_batch_emitter` — so this stays cheap even under high throughput.
/// Despite the "serial" event name, this is transport-agnostic: it forwards
/// lifecycle events from *any* publisher on the shared bus, so `NetworkManager`
/// (Tháng 6, TCP) rides along for free. `MqttMessage` rides the same bus but
/// is forwarded under its own `mqtt://message` event rather than being
/// squeezed into `PortLifecycleEvent`.
fn spawn_lifecycle_forwarder(app: AppHandle, event_bus: EventBus) {
    let rx = event_bus.subscribe();
    thread::spawn(move || {
        for event in rx {
            match event {
                Event::PortOpened { stream_id } => {
                    let _ = app.emit(
                        "serial://lifecycle",
                        PortLifecycleEvent::Opened { stream_id },
                    );
                }
                Event::PortClosed { stream_id } => {
                    let _ = app.emit(
                        "serial://lifecycle",
                        PortLifecycleEvent::Closed { stream_id },
                    );
                }
                Event::Error { stream_id, message } => {
                    let _ = app.emit(
                        "serial://lifecycle",
                        PortLifecycleEvent::Error { stream_id, message },
                    );
                }
                Event::MqttMessage {
                    stream_id,
                    topic,
                    payload,
                    qos,
                    retain,
                } => {
                    let _ = app.emit(
                        "mqtt://message",
                        MqttMessageEvent {
                            id: stream_id,
                            topic,
                            payload: payload.to_vec(),
                            qos,
                            retain,
                        },
                    );
                }
                Event::UdpDatagram {
                    stream_id,
                    from,
                    data,
                } => {
                    let _ = app.emit(
                        "udp://datagram",
                        UdpDatagramEvent {
                            id: stream_id,
                            from,
                            data: data.to_vec(),
                        },
                    );
                }
                Event::WsFrame {
                    stream_id,
                    kind,
                    data,
                } => {
                    let _ = app.emit(
                        "ws://frame",
                        WsFrameEvent {
                            id: stream_id,
                            kind: match kind {
                                WsFrameKind::Text => WsFrameKindDto::Text,
                                WsFrameKind::Binary => WsFrameKindDto::Binary,
                            },
                            data: data.to_vec(),
                        },
                    );
                }
                Event::UsbPlugged {
                    port_name,
                    vid,
                    pid,
                    serial_number,
                    manufacturer,
                    product,
                } => {
                    let _ = app.emit(
                        "usb://plugged",
                        UsbPlugEvent {
                            port_name,
                            vid,
                            pid,
                            serial_number,
                            manufacturer,
                            product,
                        },
                    );
                }
                Event::UsbUnplugged { port_name } => {
                    let _ = app.emit("usb://unplugged", UsbUnplugEvent { port_name });
                }
                Event::DataReceived { .. } => {}
            }
        }
    });
}

// ---- ESP32 flashing (M2-T1) ----
//
// Flash/erase/read all take at least seconds and up to tens of seconds, so
// each spawns a background thread and returns immediately; progress and
// completion travel over "flash://progress" / "flash://done" events tagged
// with the caller-supplied `id`, mirroring the serial batch/lifecycle event
// split. `detect_esp32_chip` is fast enough to stay synchronous.

#[tauri::command]
fn detect_esp32_chip(port_name: String) -> Result<ChipInfo, String> {
    esp32::detect_chip(&port_name)
}

/// Reads and parses a compiled ESP-IDF partition table (`partitions.bin`)
/// selected by the user — the Flash panel's "Smart add" uses this to find
/// the real offset/size of each partition instead of guessing from
/// filenames, which would risk overwriting the wrong flash region for a
/// filesystem image whose offset depends on flash size/partition scheme.
#[tauri::command]
fn parse_esp32_partition_table(path: String) -> Result<Vec<PartitionEntry>, String> {
    partition_table::parse_partition_table_file(&path)
}

// `otadata`-partition binary from espressif/arduino-esp32
// (tools/partitions/boot_app0.bin, LGPL-2.1 — see THIRD_PARTY_NOTICES.md at
// the repo root and src-tauri/resources/boot_app0.LICENSE.md) — offered by
// "Smart add" for OTA-capable partition schemes, since PlatformIO/ESP-IDF
// build output doesn't always include it.
const BOOT_APP0_BIN: &[u8] = include_bytes!("../resources/boot_app0.bin");

#[tauri::command]
fn bundled_boot_app0_path() -> Result<String, String> {
    let path = std::env::temp_dir().join("edt-boot_app0.bin");
    std::fs::write(&path, BOOT_APP0_BIN)
        .map_err(|e| format!("failed to write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FlashProgressEvent {
    id: String,
    #[serde(flatten)]
    progress: FlashProgress,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FlashDoneEvent {
    id: String,
    operation: &'static str,
    success: bool,
    message: String,
}

#[tauri::command]
fn flash_esp32(
    app: AppHandle,
    id: String,
    port_name: String,
    baud: u32,
    segments: Vec<FlashSegmentReq>,
) {
    thread::spawn(move || {
        let app_for_progress = app.clone();
        let id_for_progress = id.clone();
        let result = esp32::flash_binaries(&port_name, baud, &segments, |progress| {
            let _ = app_for_progress.emit(
                "flash://progress",
                FlashProgressEvent {
                    id: id_for_progress.clone(),
                    progress,
                },
            );
        });
        let (success, message) = match result {
            Ok(()) => (true, "Flash complete".to_string()),
            Err(e) => (false, e),
        };
        let _ = app.emit(
            "flash://done",
            FlashDoneEvent {
                id,
                operation: "flash",
                success,
                message,
            },
        );
    });
}

#[tauri::command]
fn erase_esp32_flash(app: AppHandle, id: String, port_name: String) {
    thread::spawn(move || {
        let (success, message) = match esp32::erase_flash(&port_name) {
            Ok(()) => (true, "Chip erased".to_string()),
            Err(e) => (false, e),
        };
        let _ = app.emit(
            "flash://done",
            FlashDoneEvent {
                id,
                operation: "eraseFull",
                success,
                message,
            },
        );
    });
}

#[tauri::command]
fn erase_esp32_region(app: AppHandle, id: String, port_name: String, offset: u32, size: u32) {
    thread::spawn(move || {
        let (success, message) = match esp32::erase_region(&port_name, offset, size) {
            Ok(()) => (true, format!("Erased 0x{size:x} bytes at 0x{offset:08x}")),
            Err(e) => (false, e),
        };
        let _ = app.emit(
            "flash://done",
            FlashDoneEvent {
                id,
                operation: "eraseRegion",
                success,
                message,
            },
        );
    });
}

#[tauri::command]
fn read_esp32_flash(
    app: AppHandle,
    id: String,
    port_name: String,
    offset: u32,
    size: u32,
    out_path: String,
) {
    thread::spawn(move || {
        let (success, message) = match esp32::read_flash(&port_name, offset, size, out_path.into())
        {
            Ok(()) => (true, "Read complete".to_string()),
            Err(e) => (false, e),
        };
        let _ = app.emit(
            "flash://done",
            FlashDoneEvent {
                id,
                operation: "readFlash",
                success,
                message,
            },
        );
    });
}

// ---- ESP32 OTA-over-WiFi (espota protocol) ----
//
// Separate event names from the serial flash flow above ("ota://progress" /
// "ota://done") since the phases don't line up with segment-based writes —
// there's an invite/auth handshake before any bytes move, then one
// continuous transfer instead of per-segment writes.

#[derive(Serialize, Clone)]
#[serde(tag = "phase", rename_all = "camelCase")]
enum OtaProgressPhase {
    Inviting,
    Authenticating,
    WaitingForDevice,
    Writing { current: usize, total: usize },
}

impl From<OtaProgress> for OtaProgressPhase {
    fn from(p: OtaProgress) -> Self {
        match p {
            OtaProgress::Inviting => OtaProgressPhase::Inviting,
            OtaProgress::Authenticating => OtaProgressPhase::Authenticating,
            OtaProgress::WaitingForDevice => OtaProgressPhase::WaitingForDevice,
            OtaProgress::Writing { current, total } => OtaProgressPhase::Writing { current, total },
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OtaProgressEvent {
    id: String,
    #[serde(flatten)]
    progress: OtaProgressPhase,
}

#[tauri::command]
fn ota_flash_esp32(
    app: AppHandle,
    id: String,
    host: String,
    port: u16,
    password: String,
    firmware_path: String,
) {
    thread::spawn(move || {
        let app_for_progress = app.clone();
        let id_for_progress = id.clone();
        let result = esp32_ota::ota_flash(&host, port, &password, &firmware_path, |progress| {
            let _ = app_for_progress.emit(
                "ota://progress",
                OtaProgressEvent {
                    id: id_for_progress.clone(),
                    progress: progress.into(),
                },
            );
        });
        let (success, message) = match result {
            Ok(()) => (true, "OTA update complete".to_string()),
            Err(e) => (false, e),
        };
        let _ = app.emit(
            "ota://done",
            FlashDoneEvent {
                id,
                operation: "ota",
                success,
                message,
            },
        );
    });
}

#[tauri::command]
fn save_flash_profile(path: String, profile: FlashProfile) -> Result<(), String> {
    profile::save_profile(std::path::Path::new(&path), &profile)
}

#[tauri::command]
fn load_flash_profile(path: String) -> Result<FlashProfile, String> {
    profile::load_profile(std::path::Path::new(&path))
}

// ---- STM32 flashing (M2-T2) ----
//
// Wraps the external STM32_Programmer_CLI (cannot be bundled — see
// flash::stm32 module docs). Long-running operations stream raw CLI output
// live over "stm32://output" and report completion over "stm32://done",
// mirroring the ESP32 flash event split. `find_stm32_cli`/`detect_stm32_mcu`
// stay synchronous since they're quick.

#[tauri::command]
fn find_stm32_cli() -> Option<String> {
    stm32::find_cli().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn detect_stm32_mcu(cli_path: String, interface: StmInterface) -> Result<StmMcuInfo, String> {
    stm32::detect_mcu(std::path::Path::new(&cli_path), &interface)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Stm32OutputEvent {
    id: String,
    line: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Stm32DoneEvent {
    id: String,
    operation: &'static str,
    success: bool,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FlashStm32Request {
    id: String,
    cli_path: String,
    interface: StmInterface,
    file_path: String,
    address: String,
    verify: bool,
    reset: bool,
}

#[tauri::command]
fn flash_stm32(app: AppHandle, req: FlashStm32Request) {
    let FlashStm32Request {
        id,
        cli_path,
        interface,
        file_path,
        address,
        verify,
        reset,
    } = req;
    thread::spawn(move || {
        let app_for_lines = app.clone();
        let id_for_lines = id.clone();
        let result = stm32::flash_binary(
            std::path::Path::new(&cli_path),
            &interface,
            &file_path,
            &address,
            verify,
            reset,
            |line| {
                let _ = app_for_lines.emit(
                    "stm32://output",
                    Stm32OutputEvent {
                        id: id_for_lines.clone(),
                        line: line.to_string(),
                    },
                );
            },
        );
        let (success, message) = match result {
            Ok(()) => (true, "Flash complete".to_string()),
            Err(e) => (false, e),
        };
        let _ = app.emit(
            "stm32://done",
            Stm32DoneEvent {
                id,
                operation: "flash",
                success,
                message,
            },
        );
    });
}

#[tauri::command]
fn mass_erase_stm32(app: AppHandle, id: String, cli_path: String, interface: StmInterface) {
    thread::spawn(move || {
        let app_for_lines = app.clone();
        let id_for_lines = id.clone();
        let result = stm32::mass_erase(std::path::Path::new(&cli_path), &interface, |line| {
            let _ = app_for_lines.emit(
                "stm32://output",
                Stm32OutputEvent {
                    id: id_for_lines.clone(),
                    line: line.to_string(),
                },
            );
        });
        let (success, message) = match result {
            Ok(()) => (true, "Chip erased".to_string()),
            Err(e) => (false, e),
        };
        let _ = app.emit(
            "stm32://done",
            Stm32DoneEvent {
                id,
                operation: "eraseFull",
                success,
                message,
            },
        );
    });
}

#[tauri::command]
fn read_stm32_option_bytes(cli_path: String, interface: StmInterface) -> Result<String, String> {
    stm32::read_option_bytes(std::path::Path::new(&cli_path), &interface)
}

/// The RDP confirmation dialog lives in the frontend before this is ever
/// called — see flash::stm32::write_option_byte's docs.
#[tauri::command]
fn write_stm32_option_byte(
    app: AppHandle,
    id: String,
    cli_path: String,
    interface: StmInterface,
    name: String,
    value: String,
) {
    thread::spawn(move || {
        let app_for_lines = app.clone();
        let id_for_lines = id.clone();
        let result = stm32::write_option_byte(
            std::path::Path::new(&cli_path),
            &interface,
            &name,
            &value,
            |line| {
                let _ = app_for_lines.emit(
                    "stm32://output",
                    Stm32OutputEvent {
                        id: id_for_lines.clone(),
                        line: line.to_string(),
                    },
                );
            },
        );
        let (success, message) = match result {
            Ok(()) => (true, format!("Option byte {name} written")),
            Err(e) => (false, e),
        };
        let _ = app.emit(
            "stm32://done",
            Stm32DoneEvent {
                id,
                operation: "writeOptionByte",
                success,
                message,
            },
        );
    });
}

// ---- Script engine (Tháng 5) ----
//
// A script is keyed by the same id as the tab it's attached to (one script
// slot per tab). All of its output events are tagged with that id so the
// frontend can route them back to the right tab's console/plot.

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScriptLogEvent {
    id: String,
    message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScriptPlotEvent {
    id: String,
    stream_id: String,
    channel: String,
    value: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScriptDoneEvent {
    id: String,
}

#[tauri::command]
fn run_script(
    app: AppHandle,
    port_manager: tauri::State<Arc<PortManager>>,
    scripts: tauri::State<Arc<ScriptManager>>,
    event_bus: tauri::State<EventBus>,
    id: String,
    stream_id: String,
    code: String,
) -> Result<(), String> {
    let make_emitter = {
        let app = app.clone();
        let id = id.clone();
        move |event: &'static str| {
            let app = app.clone();
            let id = id.clone();
            move |message: String| {
                let _ = app.emit(
                    event,
                    ScriptLogEvent {
                        id: id.clone(),
                        message,
                    },
                );
            }
        }
    };

    let app_for_plot = app.clone();
    let id_for_plot = id.clone();
    let stream_for_plot = stream_id.clone();
    let app_for_done = app.clone();
    let id_for_done = id.clone();

    let callbacks = ScriptCallbacks {
        on_log: Arc::new(make_emitter("script://log")),
        on_alert: Arc::new(make_emitter("script://alert")),
        on_error: Arc::new(make_emitter("script://error")),
        on_plot: Arc::new(move |channel, value| {
            let _ = app_for_plot.emit(
                "script://plot",
                ScriptPlotEvent {
                    id: id_for_plot.clone(),
                    stream_id: stream_for_plot.clone(),
                    channel,
                    value,
                },
            );
        }),
        on_done: Arc::new(move || {
            let _ = app_for_done.emit(
                "script://done",
                ScriptDoneEvent {
                    id: id_for_done.clone(),
                },
            );
        }),
    };

    scripts.run(
        port_manager.inner().clone(),
        event_bus.inner().clone(),
        id,
        stream_id,
        code,
        callbacks,
    )
}

#[tauri::command]
fn stop_script(scripts: tauri::State<Arc<ScriptManager>>, id: String) -> Result<(), String> {
    scripts.stop(&id)
}

// ---- Plugin engine ----
//
// Narrower than a script: a plugin exposes one pure function
// (decode(line) or parse(line)) called for every line, no send/wait_for.
// Keyed by a caller-assigned run id (frontend uses `${tabId}:${pluginId}`
// so the same installed plugin can run on multiple tabs at once).

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PluginDecodedEvent {
    id: String,
    fields: HashMap<String, String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PluginPlotEvent {
    id: String,
    stream_id: String,
    channel: String,
    value: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PluginErrorEvent {
    id: String,
    message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PluginDoneEvent {
    id: String,
}

#[tauri::command]
fn plugin_run(
    app: AppHandle,
    plugins: tauri::State<Arc<plugin::PluginManager>>,
    event_bus: tauri::State<EventBus>,
    id: String,
    stream_id: String,
    kind: plugin::PluginKind,
    code: String,
) -> Result<(), String> {
    let app_for_decoded = app.clone();
    let id_for_decoded = id.clone();
    let app_for_plot = app.clone();
    let id_for_plot = id.clone();
    let stream_for_plot = stream_id.clone();
    let app_for_error = app.clone();
    let id_for_error = id.clone();
    let app_for_done = app.clone();
    let id_for_done = id.clone();

    let callbacks = plugin::PluginCallbacks {
        on_decoded: Arc::new(move |fields| {
            let _ = app_for_decoded.emit(
                "plugin://decoded",
                PluginDecodedEvent {
                    id: id_for_decoded.clone(),
                    fields,
                },
            );
        }),
        on_plot: Arc::new(move |channel, value| {
            let _ = app_for_plot.emit(
                "plugin://plot",
                PluginPlotEvent {
                    id: id_for_plot.clone(),
                    stream_id: stream_for_plot.clone(),
                    channel,
                    value,
                },
            );
        }),
        on_error: Arc::new(move |message| {
            let _ = app_for_error.emit(
                "plugin://error",
                PluginErrorEvent {
                    id: id_for_error.clone(),
                    message,
                },
            );
        }),
        on_done: Arc::new(move || {
            let _ = app_for_done.emit(
                "plugin://done",
                PluginDoneEvent {
                    id: id_for_done.clone(),
                },
            );
        }),
    };

    plugins.run(
        id,
        stream_id,
        kind,
        code,
        event_bus.inner().clone(),
        callbacks,
    )
}

#[tauri::command]
fn plugin_stop(
    plugins: tauri::State<Arc<plugin::PluginManager>>,
    id: String,
) -> Result<(), String> {
    plugins.stop(&id)
}

// ---- Local REST API (optional, off by default) ----

#[tauri::command]
fn rest_api_start(
    rest_api: tauri::State<Arc<restapi::RestApiManager>>,
    port_manager: tauri::State<Arc<PortManager>>,
    event_bus: tauri::State<EventBus>,
    port: u16,
    token: String,
) -> Result<(), String> {
    rest_api.start(
        port,
        token,
        port_manager.inner().clone(),
        event_bus.inner().clone(),
    )
}

#[tauri::command]
fn rest_api_stop(rest_api: tauri::State<Arc<restapi::RestApiManager>>) {
    rest_api.stop();
}

#[tauri::command]
fn rest_api_is_running(rest_api: tauri::State<Arc<restapi::RestApiManager>>) -> bool {
    rest_api.is_running()
}

// ---- TCP client/server (Tháng 6) ----
//
// Mirrors the serial commands in shape: open/close/write plus a batch
// emitter, all driving the same `Event::PortOpened`/`Closed`/`Error`/
// `DataReceived` events on the shared EventBus so every frontend feature
// that reads from a tab by id (filters, triggers, macro, script, plotter)
// works unmodified for a TCP tab.

#[tauri::command]
fn open_tcp_client(
    network: tauri::State<Arc<NetworkManager>>,
    id: String,
    host: String,
    port: u16,
) -> Result<(), String> {
    network.open_tcp_client(id, host, port)
}

#[tauri::command]
fn open_tcp_server(
    network: tauri::State<Arc<NetworkManager>>,
    id: String,
    port: u16,
) -> Result<(), String> {
    network.open_tcp_server(id, port)
}

#[tauri::command]
fn open_udp(
    network: tauri::State<Arc<NetworkManager>>,
    id: String,
    local_port: u16,
    remote_host: Option<String>,
    remote_port: Option<u16>,
) -> Result<(), String> {
    network.open_udp(id, local_port, remote_host, remote_port)
}

#[tauri::command]
fn open_ws_client(
    network: tauri::State<Arc<NetworkManager>>,
    id: String,
    url: String,
) -> Result<(), String> {
    network.open_ws_client(id, url)
}

#[tauri::command]
fn open_ws_server(
    network: tauri::State<Arc<NetworkManager>>,
    id: String,
    port: u16,
) -> Result<(), String> {
    network.open_ws_server(id, port)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn open_mqtt(
    network: tauri::State<Arc<NetworkManager>>,
    id: String,
    broker_host: String,
    broker_port: u16,
    client_id: String,
    username: Option<String>,
    password: Option<String>,
    subscribe_topic: String,
    publish_topic: String,
) -> Result<(), String> {
    network.open_mqtt(
        id,
        broker_host,
        broker_port,
        client_id,
        username,
        password,
        subscribe_topic,
        publish_topic,
    )
}

/// SSH is a real interactive PTY shell (see core::ssh_stream), not the
/// line-oriented byte stream every other open_* command here backs — the
/// frontend renders it with a real terminal emulator (xterm.js) instead of
/// the generic monitor.
#[tauri::command]
fn open_ssh(
    network: tauri::State<Arc<NetworkManager>>,
    id: String,
    host: String,
    port: u16,
    username: String,
    password: String,
) -> Result<(), String> {
    network.open_ssh(id, host, port, username, password)
}

/// Tells an SSH tab's PTY the terminal was resized — see
/// `DataStream::resize`. No-ops (errors) for every other transport.
#[tauri::command]
fn ssh_resize(
    network: tauri::State<Arc<NetworkManager>>,
    id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    network.resize(&id, cols, rows)
}

#[tauri::command]
fn close_network_stream(
    network: tauri::State<Arc<NetworkManager>>,
    id: String,
) -> Result<(), String> {
    network.close(&id)
}

#[tauri::command]
fn write_network_stream(
    network: tauri::State<Arc<NetworkManager>>,
    id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    network.write(&id, &data)
}

/// Publishes to an arbitrary topic with explicit QoS/retain — the MQTT topic
/// explorer's Publish widget uses this instead of `write_network_stream` so
/// it isn't limited to the one `publish_topic` configured at connect time.
#[tauri::command]
fn mqtt_publish(
    network: tauri::State<Arc<NetworkManager>>,
    id: String,
    topic: String,
    payload: Vec<u8>,
    qos: u8,
    retain: bool,
) -> Result<(), String> {
    network.publish(&id, &topic, &payload, qos, retain)
}

/// Adds a subscription beyond the one topic set at connect time — the
/// topic explorer's subscription manager uses this to watch additional
/// topics without reconnecting.
#[tauri::command]
fn mqtt_subscribe(
    network: tauri::State<Arc<NetworkManager>>,
    id: String,
    topic: String,
    qos: u8,
) -> Result<(), String> {
    network.subscribe(&id, &topic, qos)
}

#[tauri::command]
fn mqtt_unsubscribe(
    network: tauri::State<Arc<NetworkManager>>,
    id: String,
    topic: String,
) -> Result<(), String> {
    network.unsubscribe(&id, &topic)
}

/// Sends a WebSocket Text frame — unlike `write_network_stream` (always
/// Binary), this preserves the frame kind for peers that distinguish them
/// (e.g. browser-side `ws.onmessage` gives a string for Text, a Blob for
/// Binary).
#[tauri::command]
fn ws_send_text(
    network: tauri::State<Arc<NetworkManager>>,
    id: String,
    text: String,
) -> Result<(), String> {
    network.send_text(&id, &text)
}

/// Same ~60fps drain shape as `spawn_batch_emitter`, over `NetworkManager`
/// instead of `PortManager` — see `emit_batches`.
fn spawn_network_batch_emitter(app: AppHandle, network: Arc<NetworkManager>, event_bus: EventBus) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(16));
        emit_batches(
            &app,
            &event_bus,
            "network://data",
            network.drain_open_streams(),
        );
    });
}

// ---- FTP client ----
//
// Deliberately not a DataStream tab like TCP/UDP/WS/MQTT: FTP is a
// stateful request/response file browser (current directory, sequential
// commands on one control connection), not a byte stream, so it gets its
// own command surface and its own frontend panel instead of MonitorView.

#[tauri::command]
fn ftp_connect(
    manager: tauri::State<Arc<ftp::FtpManager>>,
    id: String,
    host: String,
    port: u16,
    username: String,
    password: String,
) -> Result<(), String> {
    manager.connect(&id, &host, port, &username, &password)
}

#[tauri::command]
fn ftp_disconnect(manager: tauri::State<Arc<ftp::FtpManager>>, id: String) {
    manager.disconnect(&id);
}

#[tauri::command]
fn ftp_list(
    manager: tauri::State<Arc<ftp::FtpManager>>,
    id: String,
    path: String,
) -> Result<Vec<ftp::FtpEntry>, String> {
    manager.list(&id, &path)
}

#[tauri::command]
fn ftp_pwd(manager: tauri::State<Arc<ftp::FtpManager>>, id: String) -> Result<String, String> {
    manager.pwd(&id)
}

#[tauri::command]
fn ftp_cwd(
    manager: tauri::State<Arc<ftp::FtpManager>>,
    id: String,
    path: String,
) -> Result<(), String> {
    manager.cwd(&id, &path)
}

#[tauri::command]
fn ftp_mkdir(
    manager: tauri::State<Arc<ftp::FtpManager>>,
    id: String,
    path: String,
) -> Result<(), String> {
    manager.mkdir(&id, &path)
}

#[tauri::command]
fn ftp_rmdir(
    manager: tauri::State<Arc<ftp::FtpManager>>,
    id: String,
    path: String,
) -> Result<(), String> {
    manager.rmdir(&id, &path)
}

#[tauri::command]
fn ftp_delete(
    manager: tauri::State<Arc<ftp::FtpManager>>,
    id: String,
    path: String,
) -> Result<(), String> {
    manager.delete(&id, &path)
}

#[tauri::command]
fn ftp_rename(
    manager: tauri::State<Arc<ftp::FtpManager>>,
    id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    manager.rename(&id, &from, &to)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FtpTransferDoneEvent {
    id: String,
    operation: &'static str,
    success: bool,
    message: String,
}

/// Downloads/uploads run on their own thread and report completion over
/// "ftp://transferDone" — same reasoning as flash/OTA's done events, since
/// a large file can take a while and the command shouldn't block the
/// frontend's ability to do anything else meanwhile.
#[tauri::command]
fn ftp_download(
    app: AppHandle,
    manager: tauri::State<Arc<ftp::FtpManager>>,
    id: String,
    remote_path: String,
    local_path: String,
) {
    let manager = manager.inner().clone();
    thread::spawn(move || {
        let (success, message) = match manager.download(&id, &remote_path, &local_path) {
            Ok(()) => (true, "Download complete".to_string()),
            Err(e) => (false, e),
        };
        let _ = app.emit(
            "ftp://transferDone",
            FtpTransferDoneEvent {
                id,
                operation: "download",
                success,
                message,
            },
        );
    });
}

#[tauri::command]
fn ftp_upload(
    app: AppHandle,
    manager: tauri::State<Arc<ftp::FtpManager>>,
    id: String,
    local_path: String,
    remote_path: String,
) {
    let manager = manager.inner().clone();
    thread::spawn(move || {
        let (success, message) = match manager.upload(&id, &local_path, &remote_path) {
            Ok(()) => (true, "Upload complete".to_string()),
            Err(e) => (false, e),
        };
        let _ = app.emit(
            "ftp://transferDone",
            FtpTransferDoneEvent {
                id,
                operation: "upload",
                success,
                message,
            },
        );
    });
}

// ---- FTP server ----

#[tauri::command]
fn ftp_server_start(
    manager: tauri::State<Arc<ftp::FtpServerManager>>,
    root_dir: String,
    port: u16,
    username: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    manager.start(root_dir, port, username, password)
}

#[tauri::command]
fn ftp_server_stop(manager: tauri::State<Arc<ftp::FtpServerManager>>) {
    manager.stop();
}

#[tauri::command]
fn ftp_server_is_running(manager: tauri::State<Arc<ftp::FtpServerManager>>) -> bool {
    manager.is_running()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let event_bus = EventBus::new();
    let manager = Arc::new(PortManager::new(event_bus.clone()));
    let network = Arc::new(NetworkManager::new(event_bus.clone()));

    serial::manager::spawn_reconnect_watcher(manager.clone());
    serial::manager::spawn_hotplug_watcher(event_bus.clone());

    let scripts = Arc::new(ScriptManager::new());
    let plugins = Arc::new(plugin::PluginManager::new());
    let rest_api = Arc::new(restapi::RestApiManager::new());
    let ftp_manager = Arc::new(ftp::FtpManager::new());
    let ftp_server_manager = Arc::new(ftp::FtpServerManager::new());

    let manager_for_state = manager.clone();
    let network_for_state = network.clone();
    let event_bus_for_state = event_bus.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(manager_for_state)
        .manage(network_for_state)
        .manage(event_bus_for_state)
        .manage(scripts)
        .manage(plugins)
        .manage(rest_api)
        .manage(ftp_manager)
        .manage(ftp_server_manager)
        .manage(KeepAwakeState(Mutex::new(None)))
        .setup(move |app| {
            let handle = app.handle().clone();
            spawn_batch_emitter(handle.clone(), manager.clone(), event_bus.clone());
            spawn_network_batch_emitter(handle.clone(), network.clone(), event_bus.clone());
            spawn_lifecycle_forwarder(handle, event_bus.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            list_serial_ports,
            open_serial_port,
            close_serial_port,
            write_serial_port,
            append_trigger_log,
            write_text_file,
            write_binary_file,
            read_text_file,
            mdns_scan,
            detect_local_subnet,
            common_scan_ports,
            start_network_scan,
            start_deep_scan,
            serial_port_states,
            start_serial_logging,
            stop_serial_logging,
            is_serial_logging,
            set_serial_dtr,
            set_serial_rts,
            read_serial_signals,
            set_keep_awake,
            detect_esp32_chip,
            parse_esp32_partition_table,
            bundled_boot_app0_path,
            flash_esp32,
            erase_esp32_flash,
            erase_esp32_region,
            read_esp32_flash,
            ota_flash_esp32,
            save_flash_profile,
            load_flash_profile,
            find_stm32_cli,
            detect_stm32_mcu,
            flash_stm32,
            mass_erase_stm32,
            read_stm32_option_bytes,
            write_stm32_option_byte,
            run_script,
            stop_script,
            plugin_run,
            plugin_stop,
            rest_api_start,
            rest_api_stop,
            rest_api_is_running,
            open_tcp_client,
            open_tcp_server,
            open_udp,
            open_ws_client,
            open_ws_server,
            open_mqtt,
            open_ssh,
            ssh_resize,
            close_network_stream,
            write_network_stream,
            mqtt_publish,
            mqtt_subscribe,
            mqtt_unsubscribe,
            ws_send_text,
            ftp_connect,
            ftp_disconnect,
            ftp_list,
            ftp_pwd,
            ftp_cwd,
            ftp_mkdir,
            ftp_rmdir,
            ftp_delete,
            ftp_rename,
            ftp_download,
            ftp_upload,
            ftp_server_start,
            ftp_server_stop,
            ftp_server_is_running,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // Releases serial/TCP handles deterministically on shutdown
            // rather than leaving it to the OS to clean up whenever the
            // process actually terminates (some USB-UART drivers are slow
            // to free the port after a non-graceful exit).
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(manager) = app_handle.try_state::<Arc<PortManager>>() {
                    manager.close_all();
                }
                if let Some(network) = app_handle.try_state::<Arc<NetworkManager>>() {
                    network.close_all();
                }
                if let Some(rest_api) = app_handle.try_state::<Arc<restapi::RestApiManager>>() {
                    rest_api.stop();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_text_file_round_trips() {
        let path = std::env::temp_dir().join("edt-test-write-text.csv");
        let path_str = path.to_string_lossy().to_string();
        write_text_file(path_str.clone(), "a,b\n1,2\n".to_string()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "a,b\n1,2\n");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn write_binary_file_round_trips() {
        let path = std::env::temp_dir().join("edt-test-write-binary.bin");
        let path_str = path.to_string_lossy().to_string();
        write_binary_file(path_str.clone(), vec![0x89, 0x50, 0x4e, 0x47]).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), vec![0x89, 0x50, 0x4e, 0x47]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_text_file_round_trips_with_write_text_file() {
        let path = std::env::temp_dir().join("edt-test-read-text.edtproj");
        let path_str = path.to_string_lossy().to_string();
        write_text_file(path_str.clone(), "{\"version\":1}".to_string()).unwrap();
        assert_eq!(read_text_file(path_str.clone()).unwrap(), "{\"version\":1}");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_text_file_errors_on_missing_path() {
        let path = std::env::temp_dir().join("edt-test-read-text-missing.edtproj");
        assert!(read_text_file(path.to_string_lossy().to_string()).is_err());
    }

    #[test]
    fn bundled_boot_app0_writes_the_embedded_asset_unmodified() {
        let path = bundled_boot_app0_path().unwrap();
        let written = std::fs::read(&path).unwrap();
        assert_eq!(written, BOOT_APP0_BIN);
        assert_eq!(written.len(), 8192);
    }
}
