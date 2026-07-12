//! Optional local REST API (off by default) so an external CI/production-
//! line system can drive an already-running EDT instance — open a serial
//! port, write/read bytes, trigger an ESP32 flash — without needing the
//! `edt-cli` binary or reimplementing this app's manager state itself.
//! Binds to 127.0.0.1 only (never the LAN) and always requires a bearer
//! token (generated frontend-side, see `restApiEnabled` in settingsStore),
//! since this is a control surface over local hardware even though it
//! never leaves the machine.
//!
//! `tiny_http` (blocking, thread-per-request) rather than pulling
//! axum/warp into the dependency tree — matches this codebase's "prefer
//! blocking over more async machinery when it's good enough" choice
//! already made for the FTP client (see `ftp::client`'s module doc).

use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tiny_http::{Header, Method, Request, Response, Server};

use crate::core::event_bus::{Event, EventBus};
use crate::flash::esp32::{self, FlashSegmentReq};
use crate::serial::{OpenPortRequest, PortManager, PortState};

struct RunningServer {
    server: Arc<Server>,
    stop_flag: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

#[derive(Default)]
pub struct RestApiManager {
    running: Mutex<Option<RunningServer>>,
}

impl RestApiManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_running(&self) -> bool {
        self.running.lock().unwrap().is_some()
    }

    pub fn start(
        &self,
        port: u16,
        token: String,
        port_manager: Arc<PortManager>,
        event_bus: EventBus,
    ) -> Result<(), String> {
        let mut running = self.running.lock().unwrap();
        if running.is_some() {
            return Err("REST API is already running".to_string());
        }

        let server = Server::http(("127.0.0.1", port)).map_err(|e| e.to_string())?;
        let server = Arc::new(server);
        let stop_flag = Arc::new(AtomicBool::new(false));

        let server_for_thread = server.clone();
        let stop_flag_for_thread = stop_flag.clone();
        let thread = thread::spawn(move || {
            accept_loop(
                server_for_thread,
                stop_flag_for_thread,
                token,
                port_manager,
                event_bus,
            )
        });

        *running = Some(RunningServer {
            server,
            stop_flag,
            thread,
        });
        Ok(())
    }

    pub fn stop(&self) {
        let running = self.running.lock().unwrap().take();
        if let Some(running) = running {
            running.stop_flag.store(true, Ordering::Relaxed);
            running.server.unblock();
            let _ = running.thread.join();
        }
    }
}

// Each accepted request is handled on its own thread so a slow one (an
// ESP32 flash can take many seconds) never blocks simple status/read
// requests from being served in the meantime.
fn accept_loop(
    server: Arc<Server>,
    stop_flag: Arc<AtomicBool>,
    token: String,
    port_manager: Arc<PortManager>,
    event_bus: EventBus,
) {
    // Ends on unblock() (graceful stop) or the socket dying either way.
    while let Ok(request) = server.recv() {
        if stop_flag.load(Ordering::Relaxed) {
            break;
        }
        let token = token.clone();
        let port_manager = port_manager.clone();
        let event_bus = event_bus.clone();
        thread::spawn(move || handle_request(request, &token, &port_manager, &event_bus));
    }
}

fn is_authorized(request: &Request, token: &str) -> bool {
    let expected = format!("Bearer {token}");
    request.headers().iter().any(|h| {
        h.field
            .as_str()
            .as_str()
            .eq_ignore_ascii_case("Authorization")
            && h.value.as_str() == expected
    })
}

fn handle_request(
    mut request: Request,
    token: &str,
    port_manager: &Arc<PortManager>,
    event_bus: &EventBus,
) {
    if !is_authorized(&request, token) {
        let _ = request.respond(json_response(
            401,
            &ErrorBody {
                error: "missing or incorrect bearer token".to_string(),
            },
        ));
        return;
    }

    let method = request.method().clone();
    let path = request.url().split('?').next().unwrap_or("").to_string();

    let response = match (&method, path.as_str()) {
        (Method::Get, "/api/v1/status") => status_response(),
        (Method::Get, "/api/v1/serial/ports") => serial_ports_response(),
        (Method::Get, "/api/v1/serial/open") => serial_open_list_response(port_manager),
        (Method::Post, "/api/v1/serial/open") => serial_open_response(&mut request, port_manager),
        (Method::Post, "/api/v1/serial/write") => serial_write_response(&mut request, port_manager),
        (Method::Post, "/api/v1/serial/read") => serial_read_response(&mut request, event_bus),
        (Method::Post, "/api/v1/serial/close") => serial_close_response(&mut request, port_manager),
        (Method::Post, "/api/v1/esp32/flash") => esp32_flash_response(&mut request),
        _ => json_response(
            404,
            &ErrorBody {
                error: format!("no route for {method:?} {path}"),
            },
        ),
    };
    let _ = request.respond(response);
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

fn json_response<T: Serialize>(status: u16, body: &T) -> Response<Cursor<Vec<u8>>> {
    let json = serde_json::to_string(body).unwrap_or_else(|_| "{}".to_string());
    let content_type = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
    Response::from_string(json)
        .with_status_code(status)
        .with_header(content_type)
}

fn read_json_body<T: DeserializeOwned>(request: &mut Request) -> Result<T, String> {
    let mut buf = Vec::new();
    request
        .as_reader()
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    serde_json::from_slice(&buf).map_err(|e| format!("invalid request body: {e}"))
}

fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    let cleaned: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    if !cleaned.len().is_multiple_of(2) {
        return Err("dataHex must have an even number of hex digits".to_string());
    }
    (0..cleaned.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&cleaned[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Serialize)]
struct StatusBody {
    status: &'static str,
    version: &'static str,
}

fn status_response() -> Response<Cursor<Vec<u8>>> {
    json_response(
        200,
        &StatusBody {
            status: "ok",
            version: env!("CARGO_PKG_VERSION"),
        },
    )
}

fn serial_ports_response() -> Response<Cursor<Vec<u8>>> {
    match PortManager::list_available_ports() {
        Ok(ports) => json_response(200, &ports),
        Err(e) => json_response(
            500,
            &ErrorBody {
                error: e.to_string(),
            },
        ),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenPortEntry {
    id: String,
    state: PortState,
}

fn serial_open_list_response(port_manager: &Arc<PortManager>) -> Response<Cursor<Vec<u8>>> {
    let entries: Vec<OpenPortEntry> = port_manager
        .states()
        .into_iter()
        .map(|(id, state)| OpenPortEntry { id, state })
        .collect();
    json_response(200, &entries)
}

fn serial_open_response(
    request: &mut Request,
    port_manager: &Arc<PortManager>,
) -> Response<Cursor<Vec<u8>>> {
    let req: OpenPortRequest = match read_json_body(request) {
        Ok(r) => r,
        Err(e) => return json_response(400, &ErrorBody { error: e }),
    };
    let id = req.id.clone();
    match port_manager.open(req) {
        Ok(()) => json_response(200, &serde_json::json!({ "id": id })),
        Err(e) => json_response(500, &ErrorBody { error: e }),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdBody {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteBody {
    id: String,
    data_hex: String,
}

fn serial_write_response(
    request: &mut Request,
    port_manager: &Arc<PortManager>,
) -> Response<Cursor<Vec<u8>>> {
    let body: WriteBody = match read_json_body(request) {
        Ok(b) => b,
        Err(e) => return json_response(400, &ErrorBody { error: e }),
    };
    let bytes = match hex_decode(&body.data_hex) {
        Ok(b) => b,
        Err(e) => return json_response(400, &ErrorBody { error: e }),
    };
    match port_manager.write(&body.id, &bytes) {
        Ok(()) => json_response(200, &serde_json::json!({ "ok": true })),
        Err(e) => json_response(500, &ErrorBody { error: e }),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadBody {
    id: String,
    /// Clamped to 60s so one slow-polling client can't tie up a request
    /// thread indefinitely.
    timeout_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadResponseBody {
    data_hex: String,
    text: String,
}

fn serial_read_response(request: &mut Request, event_bus: &EventBus) -> Response<Cursor<Vec<u8>>> {
    let body: ReadBody = match read_json_body(request) {
        Ok(b) => b,
        Err(e) => return json_response(400, &ErrorBody { error: e }),
    };
    let rx = event_bus.subscribe();
    let deadline = Instant::now() + Duration::from_millis(body.timeout_ms.min(60_000));
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return json_response(
                200,
                &ReadResponseBody {
                    data_hex: String::new(),
                    text: String::new(),
                },
            );
        }
        match rx.recv_timeout(remaining) {
            Ok(Event::DataReceived { stream_id, data }) if stream_id == body.id => {
                return json_response(
                    200,
                    &ReadResponseBody {
                        data_hex: hex_encode(&data),
                        text: String::from_utf8_lossy(&data).into_owned(),
                    },
                );
            }
            Ok(_) => continue,
            Err(_) => {
                return json_response(
                    200,
                    &ReadResponseBody {
                        data_hex: String::new(),
                        text: String::new(),
                    },
                );
            }
        }
    }
}

fn serial_close_response(
    request: &mut Request,
    port_manager: &Arc<PortManager>,
) -> Response<Cursor<Vec<u8>>> {
    let body: IdBody = match read_json_body(request) {
        Ok(b) => b,
        Err(e) => return json_response(400, &ErrorBody { error: e }),
    };
    match port_manager.close(&body.id) {
        Ok(()) => json_response(200, &serde_json::json!({ "ok": true })),
        Err(e) => json_response(500, &ErrorBody { error: e }),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FlashBody {
    port_name: String,
    baud_rate: u32,
    segments: Vec<FlashSegmentReq>,
}

// Runs to completion on this request's own thread (see accept_loop) and
// returns the final result rather than streaming progress — a REST caller
// wants a pass/fail answer, not the GUI's live progress bar.
fn esp32_flash_response(request: &mut Request) -> Response<Cursor<Vec<u8>>> {
    let body: FlashBody = match read_json_body(request) {
        Ok(b) => b,
        Err(e) => return json_response(400, &ErrorBody { error: e }),
    };
    match esp32::flash_binaries(&body.port_name, body.baud_rate, &body.segments, |_| {}) {
        Ok(()) => json_response(200, &serde_json::json!({ "success": true })),
        Err(e) => json_response(200, &serde_json::json!({ "success": false, "message": e })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trips() {
        let bytes = vec![0x00, 0x1a, 0xff, 0x42];
        assert_eq!(hex_encode(&bytes), "001aff42");
        assert_eq!(hex_decode("001AFF42").unwrap(), bytes);
        assert_eq!(hex_decode("00 1a ff 42").unwrap(), bytes);
    }

    #[test]
    fn hex_decode_rejects_odd_length() {
        assert!(hex_decode("abc").is_err());
    }
}
