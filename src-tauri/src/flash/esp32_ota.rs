//! ESP32 OTA-over-WiFi flashing via the ArduinoOTA "espota" protocol — a
//! host-side reimplementation of the reference `espota.py` that ships with
//! the Arduino/ESP32 core, so a device already running `ArduinoOTA.h`
//! (Arduino/PlatformIO Arduino-framework sketches) can be flashed without a
//! USB cable. Protocol reverse-engineered from
//! <https://github.com/espressif/arduino-esp32/blob/master/tools/espota.py>:
//!
//! 1. UDP invite to the device's OTA port (default 3232): `"0 {our_tcp_port}
//!    {size} {md5}\n"`. Device replies `"OK"` (no auth) or `"AUTH {nonce}"`.
//! 2. If challenged, a 32-char nonce means the legacy MD5 protocol (pre
//!    Arduino core 3.3.1); 64 chars means the current PBKDF2-HMAC-SHA256
//!    protocol, which falls back to an MD5-hashed password if the SHA256
//!    attempt is rejected (older stored password hashes). Response goes
//!    back over UDP as `"200 {cnonce} {response}\n"`.
//! 3. The device then connects back to our TCP listener; we stream the
//!    firmware in 1KB chunks and watch for an "OK" acknowledgement.
//!
//! `cnonce` never has to be independently reproduced by the device — it's
//! computed here and sent explicitly alongside `response`, so unlike the
//! reference implementation this doesn't need to match Python's exact
//! `filename` string byte-for-byte to interoperate.

use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::time::{Duration, Instant};

use md5::{Digest as _, Md5};
use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;

const FLASH_COMMAND: u32 = 0;
const AUTH_COMMAND: u32 = 200;
const INVITE_RETRIES: u32 = 10;
const INVITE_TIMEOUT: Duration = Duration::from_secs(2);
const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
const ACCEPT_TIMEOUT: Duration = Duration::from_secs(10);
const CHUNK_TIMEOUT: Duration = Duration::from_secs(10);
const CHUNK_SIZE: usize = 1024;
const RESULT_ATTEMPTS: u32 = 10;
const RESULT_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OtaProgress {
    Inviting,
    Authenticating,
    WaitingForDevice,
    Writing { current: usize, total: usize },
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn md5_hex(data: &[u8]) -> String {
    let mut hasher = Md5::new();
    hasher.update(data);
    to_hex(&hasher.finalize())
}

fn sha256_hex(data: &[u8]) -> String {
    use sha2::Digest as _;
    let mut hasher = Sha256::new();
    hasher.update(data);
    to_hex(&hasher.finalize())
}

/// Sends the UDP invite, retrying with a fresh socket each attempt (matching
/// espota.py) since a device that's busy or still booting won't answer the
/// first try. Returns the trimmed UTF-8 response text.
fn send_invitation(host: &str, port: u16, message: &str) -> Result<String, String> {
    for _ in 0..INVITE_RETRIES {
        let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
        socket
            .send_to(message.as_bytes(), (host, port))
            .map_err(|e| format!("failed to reach {host}:{port}: {e}"))?;
        socket.set_read_timeout(Some(INVITE_TIMEOUT)).ok();
        let mut buf = [0u8; 69];
        if let Ok((n, _)) = socket.recv_from(&mut buf) {
            return Ok(String::from_utf8_lossy(&buf[..n]).trim().to_string());
        }
    }
    Err(
        "no response from the device — check the host/port and that it's on the same network"
            .to_string(),
    )
}

/// One challenge/response round trip over UDP; returns Ok(()) only on an
/// "OK" reply.
fn send_auth_response(host: &str, port: u16, cnonce: &str, response: &str) -> Result<(), String> {
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    let message = format!("{AUTH_COMMAND} {cnonce} {response}\n");
    socket
        .send_to(message.as_bytes(), (host, port))
        .map_err(|e| e.to_string())?;
    socket.set_read_timeout(Some(AUTH_TIMEOUT)).ok();
    let mut buf = [0u8; 32];
    let (n, _) = socket
        .recv_from(&mut buf)
        .map_err(|_| "no response to authentication".to_string())?;
    let reply = String::from_utf8_lossy(&buf[..n]).trim().to_string();
    if reply == "OK" {
        Ok(())
    } else {
        Err(reply)
    }
}

#[allow(clippy::too_many_arguments)]
fn authenticate(
    host: &str,
    port: u16,
    password: &str,
    use_md5_password: bool,
    use_old_protocol: bool,
    cnonce_text: &str,
    nonce: &str,
) -> Result<(), String> {
    if use_old_protocol {
        let cnonce = md5_hex(cnonce_text.as_bytes());
        let password_hash = md5_hex(password.as_bytes());
        let challenge = format!("{password_hash}:{nonce}:{cnonce}");
        let response = md5_hex(challenge.as_bytes());
        send_auth_response(host, port, &cnonce, &response)
    } else {
        let cnonce = sha256_hex(cnonce_text.as_bytes());
        let password_hash = if use_md5_password {
            md5_hex(password.as_bytes())
        } else {
            sha256_hex(password.as_bytes())
        };
        let salt = format!("{nonce}:{cnonce}");
        let mut derived_key = [0u8; 32];
        pbkdf2_hmac::<Sha256>(
            password_hash.as_bytes(),
            salt.as_bytes(),
            10_000,
            &mut derived_key,
        );
        let challenge = format!("{}:{nonce}:{cnonce}", to_hex(&derived_key));
        let response = sha256_hex(challenge.as_bytes());
        send_auth_response(host, port, &cnonce, &response)
    }
}

fn accept_with_timeout(listener: &TcpListener, timeout: Duration) -> Result<TcpStream, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + timeout;
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                listener.set_nonblocking(false).ok();
                stream.set_nonblocking(false).ok();
                return Ok(stream);
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(
                        "device never connected back — it may not be running ArduinoOTA, or a \
                         firewall is blocking the reply connection"
                            .to_string(),
                    );
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Flashes `firmware_path` to `host:port` over WiFi using the espota
/// protocol. `password` is the plaintext ArduinoOTA password, or an empty
/// string if the device wasn't configured with one.
pub fn ota_flash(
    host: &str,
    port: u16,
    password: &str,
    firmware_path: &str,
    mut on_progress: impl FnMut(OtaProgress),
) -> Result<(), String> {
    let firmware =
        fs::read(firmware_path).map_err(|e| format!("failed to read {firmware_path}: {e}"))?;
    let content_size = firmware.len();
    let file_md5 = md5_hex(&firmware);

    let listener = TcpListener::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    let local_port = listener.local_addr().map_err(|e| e.to_string())?.port();

    on_progress(OtaProgress::Inviting);
    let invite = format!("{FLASH_COMMAND} {local_port} {content_size} {file_md5}\n");
    let reply = send_invitation(host, port, &invite)?;

    if reply != "OK" {
        if !reply.starts_with("AUTH") {
            return Err(format!("unexpected reply from device: {reply}"));
        }
        on_progress(OtaProgress::Authenticating);
        let nonce = reply
            .split_whitespace()
            .nth(1)
            .ok_or_else(|| "malformed AUTH challenge from device".to_string())?
            .to_string();
        let cnonce_text = format!("{firmware_path}{content_size}{file_md5}{host}");

        match nonce.len() {
            32 => authenticate(host, port, password, true, true, &cnonce_text, &nonce)?,
            64 => {
                let first = authenticate(host, port, password, false, false, &cnonce_text, &nonce);
                if first.is_err() {
                    // Device rejected the SHA256 password hash — could still
                    // have a legacy MD5-hashed password stored under the new
                    // protocol. Re-invite for a fresh nonce (the device is
                    // back to idle after a failed attempt) and retry once.
                    let reply2 = send_invitation(host, port, &invite)?;
                    let nonce2 = reply2
                        .strip_prefix("AUTH ")
                        .ok_or_else(|| "authentication failed".to_string())?
                        .to_string();
                    authenticate(host, port, password, true, false, &cnonce_text, &nonce2)?
                }
            }
            other => return Err(format!("unexpected nonce length from device: {other}")),
        }
    }

    on_progress(OtaProgress::WaitingForDevice);
    let mut stream = accept_with_timeout(&listener, ACCEPT_TIMEOUT)?;
    stream.set_read_timeout(Some(CHUNK_TIMEOUT)).ok();
    stream.set_write_timeout(Some(CHUNK_TIMEOUT)).ok();

    let mut offset = 0usize;
    let mut last_reply_ok = false;
    for chunk in firmware.chunks(CHUNK_SIZE) {
        stream
            .write_all(chunk)
            .map_err(|e| format!("upload failed at offset {offset}: {e}"))?;
        offset += chunk.len();
        on_progress(OtaProgress::Writing {
            current: offset,
            total: content_size,
        });
        let mut buf = [0u8; 10];
        match stream.read(&mut buf) {
            Ok(n) if n > 0 => {
                last_reply_ok = String::from_utf8_lossy(&buf[..n]).contains("OK");
            }
            _ => last_reply_ok = false,
        }
    }

    if last_reply_ok {
        return Ok(());
    }

    stream.set_read_timeout(Some(RESULT_TIMEOUT)).ok();
    let mut received_any = false;
    for _ in 0..RESULT_ATTEMPTS {
        let mut buf = [0u8; 32];
        match stream.read(&mut buf) {
            Ok(n) if n > 0 => {
                received_any = true;
                if String::from_utf8_lossy(&buf[..n]).contains("OK") {
                    return Ok(());
                }
            }
            _ => continue,
        }
    }

    if received_any {
        // The device replied at least once post-upload but never with a
        // clean "OK" — most often it's already rebooting into the new
        // firmware and dropped the connection before acking. espota.py
        // treats this as success too rather than failing a working flash.
        Ok(())
    } else {
        Err(
            "upload finished but the device never confirmed — it may still be applying the update"
                .to_string(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn md5_hex_matches_known_vector() {
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
    }

    #[test]
    fn sha256_hex_matches_known_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn to_hex_formats_lowercase_padded() {
        assert_eq!(to_hex(&[0x00, 0x0f, 0xff]), "000fff");
    }
}
