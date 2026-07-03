pub mod core;
pub mod flash;
pub mod serial;

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::core::event_bus::{Event, EventBus};
use crate::flash::esp32::{self, ChipInfo, FlashProgress, FlashSegmentReq};
use crate::flash::profile::{self, FlashProfile};
use crate::flash::stm32::{self, Interface as StmInterface, McuInfo as StmMcuInfo};
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
                .reason("EDT serial monitoring")
                .app_name("EDT")
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

/// M1-T1.6: drains every open port's ring buffer on a ~60fps tick and emits
/// one batched event per port with data — never per byte/line.
fn spawn_batch_emitter(app: AppHandle, manager: Arc<PortManager>) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(16));
        for (id, data) in manager.drain_open_ports() {
            let _ = app.emit("serial://data", SerialDataBatch { id, data });
        }
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

/// Forwards port lifecycle events (open/close/error) from the internal
/// EventBus to the frontend. Raw data does not travel this path — see
/// `spawn_batch_emitter` — so this stays cheap even under high throughput.
fn spawn_lifecycle_forwarder(app: AppHandle, event_bus: EventBus) {
    let rx = event_bus.subscribe();
    thread::spawn(move || {
        for event in rx {
            let payload = match event {
                Event::PortOpened { stream_id } => Some(PortLifecycleEvent::Opened { stream_id }),
                Event::PortClosed { stream_id } => Some(PortLifecycleEvent::Closed { stream_id }),
                Event::Error { stream_id, message } => {
                    Some(PortLifecycleEvent::Error { stream_id, message })
                }
                Event::DataReceived { .. } => None,
            };
            if let Some(payload) = payload {
                let _ = app.emit("serial://lifecycle", payload);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let event_bus = EventBus::new();
    let manager = Arc::new(PortManager::new(event_bus.clone()));

    serial::manager::spawn_reconnect_watcher(manager.clone());

    let manager_for_state = manager.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(manager_for_state)
        .manage(KeepAwakeState(Mutex::new(None)))
        .setup(move |app| {
            let handle = app.handle().clone();
            spawn_batch_emitter(handle.clone(), manager.clone());
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
            serial_port_states,
            start_serial_logging,
            stop_serial_logging,
            is_serial_logging,
            set_serial_dtr,
            set_serial_rts,
            read_serial_signals,
            set_keep_awake,
            detect_esp32_chip,
            flash_esp32,
            erase_esp32_flash,
            erase_esp32_region,
            read_esp32_flash,
            save_flash_profile,
            load_flash_profile,
            find_stm32_cli,
            detect_stm32_mcu,
            flash_stm32,
            mass_erase_stm32,
            read_stm32_option_bytes,
            write_stm32_option_byte,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
