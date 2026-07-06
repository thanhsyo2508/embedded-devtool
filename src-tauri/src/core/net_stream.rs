//! TCP client/server and UDP `DataStream` implementations (Tháng 6). Same
//! two-thread shape as `SerialStream` (ADR-004): a socket-facing thread that
//! only reads and forwards through a channel, decoupled from the shared
//! pump thread (`core::stream_pump`) that drains into the ring buffer and
//! fans out to callbacks.

use std::io::{self, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crossbeam_channel::{unbounded, Receiver, Sender};

use super::data_stream::{DataCallback, DataStream};
use super::event_bus::{Event, EventBus};
use super::ring_buffer::RingBuffer;
use super::stream_pump::spawn_pump_thread;

const READ_BUF_SIZE: usize = 4096;
/// How often a blocked read/accept wakes up to re-check the stop flag —
/// bounds how long `close()` can take to join its threads.
const POLL_TIMEOUT: Duration = Duration::from_millis(200);
const RING_BUFFER_CAPACITY: usize = 1 << 20;

fn is_transient_timeout(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    )
}

pub struct TcpClientStream {
    host: String,
    port: u16,
    socket: Option<TcpStream>,
    reader_thread: Option<JoinHandle<()>>,
    pump_thread: Option<JoinHandle<()>>,
    stop_flag: Arc<AtomicBool>,
    connection_lost: Arc<AtomicBool>,
    buffer: Arc<Mutex<RingBuffer>>,
    callbacks: Arc<Mutex<Vec<DataCallback>>>,
}

impl TcpClientStream {
    pub fn new(host: impl Into<String>, port: u16) -> Self {
        Self {
            host: host.into(),
            port,
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

impl DataStream for TcpClientStream {
    fn open(&mut self) -> io::Result<()> {
        if self.socket.is_some() {
            return Ok(());
        }

        let socket = TcpStream::connect((self.host.as_str(), self.port))?;
        socket.set_read_timeout(Some(POLL_TIMEOUT))?;
        let mut reader_socket = socket.try_clone()?;
        self.socket = Some(socket);

        let (tx, rx): (Sender<Vec<u8>>, Receiver<Vec<u8>>) = unbounded();
        self.stop_flag.store(false, Ordering::SeqCst);
        self.connection_lost.store(false, Ordering::SeqCst);
        let stop_flag = self.stop_flag.clone();
        let connection_lost = self.connection_lost.clone();

        self.reader_thread = Some(thread::spawn(move || {
            let mut buf = [0u8; READ_BUF_SIZE];
            while !stop_flag.load(Ordering::Relaxed) {
                match reader_socket.read(&mut buf) {
                    Ok(0) => {
                        connection_lost.store(true, Ordering::SeqCst);
                        break;
                    }
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break; // pump thread gone, stream closed
                        }
                    }
                    Err(ref e) if is_transient_timeout(e) => continue,
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
            let _ = socket.shutdown(Shutdown::Both);
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
        match self.socket.as_mut() {
            Some(socket) => socket.write_all(data),
            None => Err(io::Error::new(io::ErrorKind::NotConnected, "not connected")),
        }
    }

    fn on_data(&mut self, callback: DataCallback) {
        self.callbacks.lock().unwrap().push(callback);
    }

    fn is_open(&self) -> bool {
        self.socket.is_some()
    }

    fn connection_lost(&self) -> bool {
        self.connection_lost.load(Ordering::Relaxed)
    }
}

/// Accepts one client at a time — the acceptor thread loops back to
/// `accept()` again once the current client disconnects. `client` is shared
/// with the reader thread(s) spawned per-connection since a new one starts
/// each time a client connects, all funneling into the one long-lived pump
/// thread/channel created in `open()`.
pub struct TcpServerStream {
    port: u16,
    client: Arc<Mutex<Option<TcpStream>>>,
    acceptor_thread: Option<JoinHandle<()>>,
    pump_thread: Option<JoinHandle<()>>,
    stop_flag: Arc<AtomicBool>,
    buffer: Arc<Mutex<RingBuffer>>,
    callbacks: Arc<Mutex<Vec<DataCallback>>>,
}

impl TcpServerStream {
    pub fn new(port: u16) -> Self {
        Self {
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

impl DataStream for TcpServerStream {
    fn open(&mut self) -> io::Result<()> {
        if self.acceptor_thread.is_some() {
            return Ok(());
        }

        let listener = TcpListener::bind(("0.0.0.0", self.port))?;
        listener.set_nonblocking(true)?;

        let (tx, rx): (Sender<Vec<u8>>, Receiver<Vec<u8>>) = unbounded();
        self.stop_flag.store(false, Ordering::SeqCst);
        let stop_flag = self.stop_flag.clone();
        let client = self.client.clone();

        self.acceptor_thread = Some(thread::spawn(move || {
            while !stop_flag.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((socket, _addr)) => {
                        if socket.set_read_timeout(Some(POLL_TIMEOUT)).is_err() {
                            continue;
                        }
                        let mut reader_socket = match socket.try_clone() {
                            Ok(s) => s,
                            Err(_) => continue,
                        };
                        let peer = reader_socket.peer_addr().ok();
                        *client.lock().unwrap() = Some(socket);

                        let tx = tx.clone();
                        let stop_flag = stop_flag.clone();
                        let client = client.clone();
                        thread::spawn(move || {
                            let mut buf = [0u8; READ_BUF_SIZE];
                            loop {
                                if stop_flag.load(Ordering::Relaxed) {
                                    break;
                                }
                                match reader_socket.read(&mut buf) {
                                    Ok(0) => break,
                                    Ok(n) => {
                                        if tx.send(buf[..n].to_vec()).is_err() {
                                            break;
                                        }
                                    }
                                    Err(ref e) if is_transient_timeout(e) => continue,
                                    Err(_) => break,
                                }
                            }
                            // Only clear the active client if a *newer*
                            // accept() hasn't already replaced it.
                            let mut guard = client.lock().unwrap();
                            if guard.as_ref().and_then(|s| s.peer_addr().ok()) == peer {
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
        if let Some(client) = self.client.lock().unwrap().take() {
            let _ = client.shutdown(Shutdown::Both);
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
            Some(socket) => socket.write_all(data),
            None => Err(io::Error::new(
                io::ErrorKind::NotConnected,
                "no client connected",
            )),
        }
    }

    fn on_data(&mut self, callback: DataCallback) {
        self.callbacks.lock().unwrap().push(callback);
    }

    fn is_open(&self) -> bool {
        self.acceptor_thread.is_some()
    }
}

/// UDP is connectionless, so there's no client/server split like TCP — one
/// socket bound to `local_port` both receives from anyone and (if `remote`
/// is set) sends to one configured target. Broadcast is enabled
/// unconditionally since it's a per-socket flag with no downside for
/// unicast use, matching the plan's "unicast/broadcast" being one feature.
pub struct UdpDataStream {
    stream_id: String,
    event_bus: EventBus,
    local_port: u16,
    remote: Option<(String, u16)>,
    socket: Option<UdpSocket>,
    reader_thread: Option<JoinHandle<()>>,
    pump_thread: Option<JoinHandle<()>>,
    stop_flag: Arc<AtomicBool>,
    buffer: Arc<Mutex<RingBuffer>>,
    callbacks: Arc<Mutex<Vec<DataCallback>>>,
}

impl UdpDataStream {
    pub fn new(
        stream_id: String,
        event_bus: EventBus,
        local_port: u16,
        remote: Option<(String, u16)>,
    ) -> Self {
        Self {
            stream_id,
            event_bus,
            local_port,
            remote,
            socket: None,
            reader_thread: None,
            pump_thread: None,
            stop_flag: Arc::new(AtomicBool::new(false)),
            buffer: Arc::new(Mutex::new(RingBuffer::new(RING_BUFFER_CAPACITY))),
            callbacks: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl DataStream for UdpDataStream {
    fn open(&mut self) -> io::Result<()> {
        if self.socket.is_some() {
            return Ok(());
        }

        let socket = UdpSocket::bind(("0.0.0.0", self.local_port))?;
        socket.set_broadcast(true)?;
        socket.set_read_timeout(Some(POLL_TIMEOUT))?;
        let reader_socket = socket.try_clone()?;
        self.socket = Some(socket);

        let (tx, rx): (Sender<Vec<u8>>, Receiver<Vec<u8>>) = unbounded();
        self.stop_flag.store(false, Ordering::SeqCst);
        let stop_flag = self.stop_flag.clone();
        let stream_id = self.stream_id.clone();
        let event_bus = self.event_bus.clone();

        self.reader_thread = Some(thread::spawn(move || {
            let mut buf = [0u8; READ_BUF_SIZE];
            while !stop_flag.load(Ordering::Relaxed) {
                match reader_socket.recv_from(&mut buf) {
                    Ok((n, sender)) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break; // pump thread gone, stream closed
                        }
                        event_bus.publish(Event::UdpDatagram {
                            stream_id: stream_id.clone(),
                            from: sender.to_string(),
                            data: Arc::from(&buf[..n]),
                        });
                    }
                    Err(ref e) if is_transient_timeout(e) => continue,
                    // No "peer closed" concept for a connectionless socket —
                    // any other error here is transient (e.g. an ICMP port
                    // unreachable for a previous send), not fatal.
                    Err(_) => continue,
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
        let (host, port) = self.remote.as_ref().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotConnected, "no remote address configured")
        })?;
        match self.socket.as_ref() {
            Some(socket) => socket.send_to(data, (host.as_str(), *port)).map(|_| ()),
            None => Err(io::Error::new(io::ErrorKind::NotConnected, "not open")),
        }
    }

    fn on_data(&mut self, callback: DataCallback) {
        self.callbacks.lock().unwrap().push(callback);
    }

    fn is_open(&self) -> bool {
        self.socket.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    // Loopback-only (127.0.0.1) round trip — unlike serial, TCP needs no
    // real hardware to exercise for real, so this validates the full
    // accept/read/write/close path rather than just error branches.
    #[test]
    fn tcp_client_and_server_round_trip() {
        let port = 18271;
        let mut server = TcpServerStream::new(port);
        server.open().unwrap();

        let mut client = TcpClientStream::new("127.0.0.1", port);
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

    #[test]
    fn udp_round_trip() {
        let port_a = 18272;
        let port_b = 18273;
        let mut a = UdpDataStream::new(
            "a".to_string(),
            EventBus::new(),
            port_a,
            Some(("127.0.0.1".to_string(), port_b)),
        );
        let mut b = UdpDataStream::new(
            "b".to_string(),
            EventBus::new(),
            port_b,
            Some(("127.0.0.1".to_string(), port_a)),
        );
        a.open().unwrap();
        b.open().unwrap();

        a.write(b"ping").unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut received = Vec::new();
        while received.is_empty() && Instant::now() < deadline {
            received = b.read().unwrap();
            if received.is_empty() {
                thread::sleep(Duration::from_millis(50));
            }
        }
        assert_eq!(received, b"ping");

        b.write(b"pong").unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut reply = Vec::new();
        while reply.is_empty() && Instant::now() < deadline {
            reply = a.read().unwrap();
            if reply.is_empty() {
                thread::sleep(Duration::from_millis(50));
            }
        }
        assert_eq!(reply, b"pong");

        a.close().unwrap();
        b.close().unwrap();
    }
}
