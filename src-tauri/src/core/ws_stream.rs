//! WebSocket client/server `DataStream` implementations (Tháng 6). Uses
//! plain `tungstenite` (not `tokio-tungstenite`) so this stays a blocking,
//! thread-per-connection transport like TCP/UDP in `net_stream.rs`, rather
//! than pulling async/tokio bridging into the write path the way MQTT's
//! `rumqttc` client required.
//!
//! Each `WebSocket<TcpStream>` is behind one `Mutex`, unlike TCP's dual
//! independent read/write socket handles — tungstenite's internal protocol
//! state (write buffer, auto Pong replies during `read()`) isn't safe to
//! touch from two threads without synchronization.
//!
//! The WS handshake is always done on a stream with no read timeout set yet
//! (fully blocking), so a slow-but-valid handshake can't be misread as
//! `HandshakeError::Interrupted` (tungstenite's "would block" signal, which
//! only makes sense for non-blocking streams). The timeout is applied only
//! afterward, for the ongoing per-message read loop.

use std::io;
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crossbeam_channel::{unbounded, Receiver, Sender};
use http::Uri;
use tungstenite::{Message, WebSocket};

use super::data_stream::{DataCallback, DataStream};
use super::event_bus::{Event, EventBus, WsFrameKind};
use super::ring_buffer::RingBuffer;
use super::stream_pump::spawn_pump_thread;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(1);
const POLL_TIMEOUT: Duration = Duration::from_millis(200);
const RING_BUFFER_CAPACITY: usize = 1 << 20;

fn is_transient_timeout(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    )
}

/// True if `err` is just the read-timeout firing (nothing to report), so
/// the caller's read loop should simply try again.
fn is_transient(err: &tungstenite::Error) -> bool {
    matches!(err, tungstenite::Error::Io(e) if is_transient_timeout(e))
}

/// Not part of `DataStream` — every message this stream forwards into the
/// byte pipeline. Text becomes UTF-8 bytes (newline-terminated so each
/// message reads as one monitor line); Binary passes through unmodified so
/// tunneled binary protocols aren't corrupted. Ping/Pong/Frame are consumed
/// by tungstenite internally and never forwarded. Also publishes a
/// `WsFrame` event carrying the original frame kind (Text vs Binary) and
/// un-terminated payload, for the frame-aware UI — `DataReceived`'s
/// newline-terminated/flattened bytes can't tell the two apart.
fn forward_message(
    msg: Message,
    tx: &Sender<Vec<u8>>,
    stream_id: &str,
    event_bus: &EventBus,
) -> Option<bool> {
    match msg {
        Message::Text(text) => {
            event_bus.publish(Event::WsFrame {
                stream_id: stream_id.to_string(),
                kind: WsFrameKind::Text,
                data: Arc::from(text.as_bytes()),
            });
            let mut bytes = text.into_bytes();
            if bytes.last() != Some(&b'\n') {
                bytes.push(b'\n');
            }
            Some(tx.send(bytes).is_ok())
        }
        Message::Binary(data) => {
            event_bus.publish(Event::WsFrame {
                stream_id: stream_id.to_string(),
                kind: WsFrameKind::Binary,
                data: Arc::from(data.as_slice()),
            });
            Some(tx.send(data).is_ok())
        }
        Message::Close(_) => None,
        Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => Some(true),
    }
}

fn host_port_from_url(url: &str) -> io::Result<(String, u16)> {
    let uri: Uri = url
        .parse()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid WebSocket URL"))?;
    let host = uri
        .host()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "URL is missing a host"))?
        .to_string();
    let port = uri.port_u16().unwrap_or(80);
    Ok((host, port))
}

pub struct WsClientStream {
    stream_id: String,
    event_bus: EventBus,
    url: String,
    socket: Option<Arc<Mutex<WebSocket<TcpStream>>>>,
    reader_thread: Option<JoinHandle<()>>,
    pump_thread: Option<JoinHandle<()>>,
    stop_flag: Arc<AtomicBool>,
    connection_lost: Arc<AtomicBool>,
    buffer: Arc<Mutex<RingBuffer>>,
    callbacks: Arc<Mutex<Vec<DataCallback>>>,
}

impl WsClientStream {
    pub fn new(stream_id: String, event_bus: EventBus, url: impl Into<String>) -> Self {
        Self {
            stream_id,
            event_bus,
            url: url.into(),
            socket: None,
            reader_thread: None,
            pump_thread: None,
            stop_flag: Arc::new(AtomicBool::new(false)),
            connection_lost: Arc::new(AtomicBool::new(false)),
            buffer: Arc::new(Mutex::new(RingBuffer::new(RING_BUFFER_CAPACITY))),
            callbacks: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl DataStream for WsClientStream {
    fn open(&mut self) -> io::Result<()> {
        if self.socket.is_some() {
            return Ok(());
        }

        let (host, port) = host_port_from_url(&self.url)?;
        let addr: std::net::SocketAddr = format!("{host}:{port}")
            .parse()
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid socket address"))?;
        let tcp = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)
            .map_err(|e| io::Error::new(e.kind(), format!("connect failed: {e}")))?;
        tcp.set_nodelay(true).ok();
        tcp.set_read_timeout(Some(POLL_TIMEOUT))?;
        tcp.set_write_timeout(Some(POLL_TIMEOUT))?;

        let (ws, _response) =
            tungstenite::client(&self.url, tcp).map_err(|e| io::Error::other(e.to_string()))?;
        ws.get_ref().set_read_timeout(Some(POLL_TIMEOUT))?;
        ws.get_ref().set_write_timeout(Some(POLL_TIMEOUT))?;
        let socket = Arc::new(Mutex::new(ws));
        self.socket = Some(socket.clone());

        let (tx, rx): (Sender<Vec<u8>>, Receiver<Vec<u8>>) = unbounded();
        self.stop_flag.store(false, Ordering::SeqCst);
        self.connection_lost.store(false, Ordering::SeqCst);
        let stop_flag = self.stop_flag.clone();
        let connection_lost = self.connection_lost.clone();
        let stream_id = self.stream_id.clone();
        let event_bus = self.event_bus.clone();

        self.reader_thread = Some(thread::spawn(move || {
            while !stop_flag.load(Ordering::Relaxed) {
                let result = socket.lock().unwrap().read();
                match result {
                    Ok(msg) => match forward_message(msg, &tx, &stream_id, &event_bus) {
                        Some(true) => continue,
                        Some(false) => break, // pump thread gone, stream closed
                        None => {
                            connection_lost.store(true, Ordering::SeqCst);
                            break;
                        }
                    },
                    Err(ref e) if is_transient(e) => continue,
                    Err(_) => {
                        connection_lost.store(true, Ordering::SeqCst);
                        break;
                    }
                }
            }
        }));

        self.pump_thread = Some(spawn_pump_thread(
            rx,
            self.buffer.clone(),
            self.callbacks.clone(),
        ));

        Ok(())
    }

    fn close(&mut self) -> io::Result<()> {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(socket) = &self.socket {
            let _ = socket.lock().unwrap().get_ref().shutdown(Shutdown::Both);
        }
        if let Some(handle) = self.reader_thread.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.pump_thread.take() {
            let _ = handle.join();
        }
        self.socket = None;
        Ok(())
    }

    fn read(&mut self) -> io::Result<Vec<u8>> {
        Ok(self.buffer.lock().unwrap().drain_all())
    }

    fn write(&mut self, data: &[u8]) -> io::Result<()> {
        match &self.socket {
            Some(socket) => socket
                .lock()
                .unwrap()
                .send(Message::Binary(data.to_vec()))
                .map_err(io::Error::other),
            None => Err(io::Error::new(io::ErrorKind::NotConnected, "not connected")),
        }
    }

    fn on_data(&mut self, callback: DataCallback) {
        self.callbacks.lock().unwrap().push(callback);
    }

    fn send_text(&mut self, text: &str) -> io::Result<()> {
        match &self.socket {
            Some(socket) => socket
                .lock()
                .unwrap()
                .send(Message::Text(text.to_string()))
                .map_err(io::Error::other),
            None => Err(io::Error::new(io::ErrorKind::NotConnected, "not connected")),
        }
    }

    fn is_open(&self) -> bool {
        self.socket.is_some()
    }

    fn connection_lost(&self) -> bool {
        self.connection_lost.load(Ordering::Relaxed)
    }
}

/// Accepts one client at a time, same shape as `TcpServerStream` — a new
/// handshake replaces whatever connection was previously active.
pub struct WsServerStream {
    stream_id: String,
    event_bus: EventBus,
    port: u16,
    client: Arc<Mutex<Option<WebSocket<TcpStream>>>>,
    acceptor_thread: Option<JoinHandle<()>>,
    pump_thread: Option<JoinHandle<()>>,
    stop_flag: Arc<AtomicBool>,
    buffer: Arc<Mutex<RingBuffer>>,
    callbacks: Arc<Mutex<Vec<DataCallback>>>,
}

impl WsServerStream {
    pub fn new(stream_id: String, event_bus: EventBus, port: u16) -> Self {
        Self {
            stream_id,
            event_bus,
            port,
            client: Arc::new(Mutex::new(None)),
            acceptor_thread: None,
            pump_thread: None,
            stop_flag: Arc::new(AtomicBool::new(false)),
            buffer: Arc::new(Mutex::new(RingBuffer::new(RING_BUFFER_CAPACITY))),
            callbacks: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl DataStream for WsServerStream {
    fn open(&mut self) -> io::Result<()> {
        if self.acceptor_thread.is_some() {
            return Ok(());
        }

        let listener = TcpListener::bind(("0.0.0.0", self.port))?;
        if self.port == 0 {
            self.port = listener.local_addr()?.port();
        }
        listener.set_nonblocking(true)?;

        let (tx, rx): (Sender<Vec<u8>>, Receiver<Vec<u8>>) = unbounded();
        self.stop_flag.store(false, Ordering::SeqCst);
        let stop_flag = self.stop_flag.clone();
        let client = self.client.clone();
        let stream_id = self.stream_id.clone();
        let event_bus = self.event_bus.clone();

        self.acceptor_thread = Some(thread::spawn(move || {
            while !stop_flag.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((tcp, _addr)) => {
                        // Handshake on a still-blocking stream. Apply a socket
                        // timeout so a stalled or malformed websocket handshake
                        // doesn't hang the acceptor thread forever.
                        let _ = tcp.set_read_timeout(Some(POLL_TIMEOUT));
                        let _ = tcp.set_write_timeout(Some(POLL_TIMEOUT));
                        let ws = match tungstenite::accept(tcp) {
                            Ok(ws) => ws,
                            Err(_) => continue, // failed handshake; keep listening
                        };
                        if ws.get_ref().set_read_timeout(Some(POLL_TIMEOUT)).is_err() {
                            continue;
                        }
                        let peer = ws.get_ref().peer_addr().ok();
                        *client.lock().unwrap() = Some(ws);

                        let tx = tx.clone();
                        let stop_flag = stop_flag.clone();
                        let client = client.clone();
                        let stream_id = stream_id.clone();
                        let event_bus = event_bus.clone();
                        thread::spawn(move || {
                            loop {
                                if stop_flag.load(Ordering::Relaxed) {
                                    break;
                                }
                                let result = {
                                    let mut guard = client.lock().unwrap();
                                    match guard.as_mut() {
                                        Some(ws) => ws.read(),
                                        None => break, // replaced by a newer connection
                                    }
                                };
                                match result {
                                    Ok(msg) => {
                                        match forward_message(msg, &tx, &stream_id, &event_bus) {
                                            Some(true) => continue,
                                            Some(false) => break,
                                            None => break, // peer closed
                                        }
                                    }
                                    Err(ref e) if is_transient(e) => continue,
                                    Err(_) => break,
                                }
                            }
                            // Only clear the active client if a *newer*
                            // accept() hasn't already replaced it.
                            let mut guard = client.lock().unwrap();
                            if guard.as_ref().and_then(|ws| ws.get_ref().peer_addr().ok()) == peer {
                                *guard = None;
                            }
                        });
                    }
                    Err(ref e) if is_transient_timeout(e) => {
                        thread::sleep(POLL_TIMEOUT);
                    }
                    Err(_) => thread::sleep(POLL_TIMEOUT),
                }
            }
        }));

        self.pump_thread = Some(spawn_pump_thread(
            rx,
            self.buffer.clone(),
            self.callbacks.clone(),
        ));
        Ok(())
    }

    fn close(&mut self) -> io::Result<()> {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(ws) = self.client.lock().unwrap().take() {
            let _ = ws.get_ref().shutdown(Shutdown::Both);
        }
        if let Some(handle) = self.acceptor_thread.take() {
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

    fn write(&mut self, data: &[u8]) -> io::Result<()> {
        match self.client.lock().unwrap().as_mut() {
            Some(ws) => ws
                .send(Message::Binary(data.to_vec()))
                .map_err(io::Error::other),
            None => Err(io::Error::new(
                io::ErrorKind::NotConnected,
                "no client connected",
            )),
        }
    }

    fn on_data(&mut self, callback: DataCallback) {
        self.callbacks.lock().unwrap().push(callback);
    }

    fn send_text(&mut self, text: &str) -> io::Result<()> {
        match self.client.lock().unwrap().as_mut() {
            Some(ws) => ws
                .send(Message::Text(text.to_string()))
                .map_err(io::Error::other),
            None => Err(io::Error::new(
                io::ErrorKind::NotConnected,
                "no client connected",
            )),
        }
    }

    fn is_open(&self) -> bool {
        self.acceptor_thread.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    // Loopback-only, real handshake + message round trip — same idea as
    // net_stream.rs's TCP/UDP tests: fully exercisable without hardware.
    #[test]
    fn ws_client_and_server_round_trip() {
        let mut server = WsServerStream::new("server".to_string(), EventBus::new(), 0);
        server.open().unwrap();
        let port = server.port;

        let mut client = WsClientStream::new(
            "client".to_string(),
            EventBus::new(),
            format!("ws://127.0.0.1:{port}/"),
        );
        let deadline = Instant::now() + Duration::from_secs(2);
        let connected = loop {
            if client.open().is_ok() {
                break true;
            }
            if Instant::now() > deadline {
                break false;
            }
            thread::sleep(Duration::from_millis(50));
        };
        assert!(connected, "client failed to connect to test server");

        client.write(b"hello").unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut received = Vec::new();
        while received.is_empty() && Instant::now() < deadline {
            received = server.read().unwrap();
            if received.is_empty() {
                thread::sleep(Duration::from_millis(50));
            }
        }
        assert_eq!(received, b"hello");

        server.write(b"hi back").unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut reply = Vec::new();
        while reply.is_empty() && Instant::now() < deadline {
            reply = client.read().unwrap();
            if reply.is_empty() {
                thread::sleep(Duration::from_millis(50));
            }
        }
        assert_eq!(reply, b"hi back");

        client.close().unwrap();
        server.close().unwrap();
    }
}
