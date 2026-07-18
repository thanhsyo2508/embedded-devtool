//! Manages open TCP client/server and UDP connections (Tháng 6), publishing
//! the same `Event::PortOpened`/`PortClosed`/`Error`/`DataReceived` events
//! used by serial (ADR-003/004) onto the shared `EventBus` — Filters,
//! Triggers, Macro, the script engine, and the plotter all keep working
//! unmodified regardless of transport, since none of them are aware a
//! stream's id came from the network rather than a serial port.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::core::data_stream::DataStream;
use crate::core::event_bus::{Event, EventBus};
use crate::core::mqtt_stream::{MqttConfig, MqttStream};
use crate::core::net_stream::{TcpClientStream, TcpServerStream, UdpDataStream};
use crate::core::rtt_stream::{RttConfig, RttStream};
use crate::core::ssh_stream::SshStream;
use crate::core::ws_stream::{WsClientStream, WsServerStream};

// Same per-stream locking shape as `PortManager` (see serial/manager.rs):
// the outer `streams` lock only guards the map's *shape* and is held just
// long enough to look up or clone an Arc handle — never across a slow
// per-stream operation (a connect, a blocking write, a close that joins
// threads). Before this, one MQTT tab connecting to an unreachable broker
// held the single map-wide lock for its whole 8s CONNACK timeout, freezing
// the 16ms drain tick — and with it every other network tab's data.
type SharedStream = Arc<Mutex<Box<dyn DataStream>>>;

pub struct NetworkManager {
    streams: Mutex<HashMap<String, SharedStream>>,
    event_bus: EventBus,
}

impl NetworkManager {
    pub fn new(event_bus: EventBus) -> Self {
        Self {
            streams: Mutex::new(HashMap::new()),
            event_bus,
        }
    }

    /// Snapshot of `(id, stream handle)` pairs, taken under the outer lock
    /// just long enough to clone the Arcs — never held while touching an
    /// individual stream afterward.
    fn snapshot(&self) -> Vec<(String, SharedStream)> {
        self.streams
            .lock()
            .unwrap()
            .iter()
            .map(|(id, stream)| (id.clone(), stream.clone()))
            .collect()
    }

    fn get(&self, id: &str) -> Option<SharedStream> {
        self.streams.lock().unwrap().get(id).cloned()
    }

    pub fn open_tcp_client(&self, id: String, host: String, port: u16) -> Result<(), String> {
        self.open(id, Box::new(TcpClientStream::new(host, port)))
    }

    pub fn open_tcp_server(&self, id: String, port: u16) -> Result<(), String> {
        self.open(id, Box::new(TcpServerStream::new(port)))
    }

    pub fn open_udp(
        &self,
        id: String,
        local_port: u16,
        remote_host: Option<String>,
        remote_port: Option<u16>,
    ) -> Result<(), String> {
        let remote = match (remote_host, remote_port) {
            (Some(host), Some(port)) if !host.is_empty() => Some((host, port)),
            _ => None,
        };
        self.open(
            id.clone(),
            Box::new(UdpDataStream::new(
                id,
                self.event_bus.clone(),
                local_port,
                remote,
            )),
        )
    }

    pub fn open_ws_client(&self, id: String, url: String) -> Result<(), String> {
        self.open(
            id.clone(),
            Box::new(WsClientStream::new(id, self.event_bus.clone(), url)),
        )
    }

    pub fn open_ws_server(&self, id: String, port: u16) -> Result<(), String> {
        self.open(
            id.clone(),
            Box::new(WsServerStream::new(id, self.event_bus.clone(), port)),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn open_mqtt(
        &self,
        id: String,
        broker_host: String,
        broker_port: u16,
        client_id: String,
        username: Option<String>,
        password: Option<String>,
        subscribe_topic: String,
        publish_topic: String,
    ) -> Result<(), String> {
        self.open(
            id.clone(),
            Box::new(MqttStream::new(
                id,
                self.event_bus.clone(),
                MqttConfig {
                    broker_host,
                    broker_port,
                    client_id,
                    username,
                    password,
                    subscribe_topic,
                    publish_topic,
                },
            )),
        )
    }

    pub fn open_rtt(
        &self,
        id: String,
        probe_serial: Option<String>,
        chip: String,
    ) -> Result<(), String> {
        self.open(
            id.clone(),
            Box::new(RttStream::new(
                id,
                self.event_bus.clone(),
                RttConfig { probe_serial, chip },
            )),
        )
    }

    /// Starts polling one variable's live value over SWD — see
    /// `DataStream::watch_variable`. Only valid for a tab opened with
    /// `open_rtt`; every other transport rejects this.
    pub fn watch_variable(
        &self,
        id: &str,
        name: String,
        address: u64,
        size: u8,
    ) -> Result<(), String> {
        match self.get(id) {
            Some(stream) => stream
                .lock()
                .unwrap()
                .watch_variable(name, address, size)
                .map_err(|e| e.to_string()),
            None => Err(format!("stream id '{id}' not found")),
        }
    }

    pub fn unwatch_variable(&self, id: &str, name: &str) -> Result<(), String> {
        match self.get(id) {
            Some(stream) => stream
                .lock()
                .unwrap()
                .unwatch_variable(name)
                .map_err(|e| e.to_string()),
            None => Err(format!("stream id '{id}' not found")),
        }
    }

    pub fn open_ssh(
        &self,
        id: String,
        host: String,
        port: u16,
        username: String,
        password: String,
    ) -> Result<(), String> {
        self.open(id, Box::new(SshStream::new(host, port, username, password)))
    }

    fn open(&self, id: String, mut stream: Box<dyn DataStream>) -> Result<(), String> {
        {
            let streams = self.streams.lock().unwrap();
            if streams.contains_key(&id) {
                return Err(format!("stream id '{id}' is already open"));
            }
        }

        // stream.open() can block for seconds (TCP connect, MQTT CONNACK,
        // SSH ready, RTT probe attach) — it must run with no lock held.
        match stream.open() {
            Ok(()) => {
                let mut streams = self.streams.lock().unwrap();
                if streams.contains_key(&id) {
                    // Raced with another open() of the same id while we were
                    // connecting with no lock held; close what we just opened
                    // and preserve the original "already open" error instead
                    // of clobbering the winner's entry.
                    let _ = stream.close();
                    return Err(format!("stream id '{id}' is already open"));
                }
                streams.insert(id.clone(), Arc::new(Mutex::new(stream)));
                self.event_bus.publish(Event::PortOpened { stream_id: id });
                Ok(())
            }
            Err(e) => {
                let message = e.to_string();
                self.event_bus.publish(Event::Error {
                    stream_id: id,
                    message: message.clone(),
                });
                Err(message)
            }
        }
    }

    pub fn close(&self, id: &str) -> Result<(), String> {
        let stream = self.streams.lock().unwrap().remove(id);
        match stream {
            Some(stream) => {
                let _ = stream.lock().unwrap().close();
                self.event_bus.publish(Event::PortClosed {
                    stream_id: id.to_string(),
                });
                Ok(())
            }
            None => Err(format!("stream id '{id}' not found")),
        }
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        match self.get(id) {
            Some(stream) => stream
                .lock()
                .unwrap()
                .write(data)
                .map_err(|e| e.to_string()),
            None => Err(format!("stream id '{id}' not found")),
        }
    }

    /// Topic-based publish for MQTT tabs — see `DataStream::publish`. Every
    /// other transport rejects this with its default "unsupported" error.
    pub fn publish(
        &self,
        id: &str,
        topic: &str,
        data: &[u8],
        qos: u8,
        retain: bool,
    ) -> Result<(), String> {
        match self.get(id) {
            Some(stream) => stream
                .lock()
                .unwrap()
                .publish(topic, data, qos, retain)
                .map_err(|e| e.to_string()),
            None => Err(format!("stream id '{id}' not found")),
        }
    }

    /// Adds an MQTT subscription beyond the one topic set at connect time —
    /// see `DataStream::subscribe`.
    pub fn subscribe(&self, id: &str, topic: &str, qos: u8) -> Result<(), String> {
        match self.get(id) {
            Some(stream) => stream
                .lock()
                .unwrap()
                .subscribe(topic, qos)
                .map_err(|e| e.to_string()),
            None => Err(format!("stream id '{id}' not found")),
        }
    }

    pub fn unsubscribe(&self, id: &str, topic: &str) -> Result<(), String> {
        match self.get(id) {
            Some(stream) => stream
                .lock()
                .unwrap()
                .unsubscribe(topic)
                .map_err(|e| e.to_string()),
            None => Err(format!("stream id '{id}' not found")),
        }
    }

    /// Sends a WebSocket Text frame — see `DataStream::send_text`. Every
    /// other transport rejects this with its default "unsupported" error.
    pub fn send_text(&self, id: &str, text: &str) -> Result<(), String> {
        match self.get(id) {
            Some(stream) => stream
                .lock()
                .unwrap()
                .send_text(text)
                .map_err(|e| e.to_string()),
            None => Err(format!("stream id '{id}' not found")),
        }
    }

    /// Tells an SSH tab's PTY the terminal size changed — see
    /// `DataStream::resize`. Every other transport rejects this.
    pub fn resize(&self, id: &str, cols: u32, rows: u32) -> Result<(), String> {
        match self.get(id) {
            Some(stream) => stream
                .lock()
                .unwrap()
                .resize(cols, rows)
                .map_err(|e| e.to_string()),
            None => Err(format!("stream id '{id}' not found")),
        }
    }

    /// Drains buffered bytes for every open stream and cleans up (+reports)
    /// any whose connection dropped on its own — e.g. a TCP client whose
    /// peer closed the socket. Called on the same ~16ms tick as
    /// `PortManager::drain_open_ports`.
    pub fn drain_open_streams(&self) -> Vec<(String, Vec<u8>)> {
        let mut out = Vec::new();
        let mut lost = Vec::new();
        for (id, stream) in self.snapshot() {
            // try_lock: a stream busy in a slow write must not stall this
            // tick for every *other* stream — its bytes just wait in the
            // ring buffer until the next tick.
            let Ok(mut stream) = stream.try_lock() else {
                continue;
            };
            if let Ok(bytes) = stream.read() {
                if !bytes.is_empty() {
                    out.push((id.clone(), bytes));
                }
            }
            if stream.connection_lost() {
                lost.push(id);
            }
        }
        for id in lost {
            let removed = self.streams.lock().unwrap().remove(&id);
            if let Some(stream) = removed {
                let _ = stream.lock().unwrap().close();
                self.event_bus.publish(Event::Error {
                    stream_id: id,
                    message: "connection closed by peer".to_string(),
                });
            }
        }
        out
    }

    /// Closes every currently tracked stream — called on app shutdown,
    /// mirroring `PortManager::close_all`.
    pub fn close_all(&self) {
        let streams: Vec<(String, SharedStream)> = self.streams.lock().unwrap().drain().collect();
        for (id, stream) in streams {
            let _ = stream.lock().unwrap().close();
            self.event_bus.publish(Event::PortClosed { stream_id: id });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::data_stream::DataCallback;
    use std::thread;
    use std::time::{Duration, Instant};

    /// Stands in for any transport whose connect is slow (an unreachable
    /// MQTT broker, a TCP host that doesn't answer).
    struct SlowOpenStream;

    impl DataStream for SlowOpenStream {
        fn open(&mut self) -> std::io::Result<()> {
            thread::sleep(Duration::from_millis(400));
            Ok(())
        }
        fn close(&mut self) -> std::io::Result<()> {
            Ok(())
        }
        fn read(&mut self) -> std::io::Result<Vec<u8>> {
            Ok(Vec::new())
        }
        fn write(&mut self, _data: &[u8]) -> std::io::Result<()> {
            Ok(())
        }
        fn on_data(&mut self, _callback: DataCallback) {}
        fn is_open(&self) -> bool {
            true
        }
    }

    // Guards the per-stream locking shape: a slow connect must not hold the
    // map lock, or the 16ms drain tick (all network tabs' data) stalls for
    // the whole connect timeout.
    #[test]
    fn drain_is_not_blocked_by_slow_open() {
        let manager = std::sync::Arc::new(NetworkManager::new(EventBus::new()));
        let manager_for_open = manager.clone();
        let opener = thread::spawn(move || {
            let _ = manager_for_open.open("slow".to_string(), Box::new(SlowOpenStream));
        });
        thread::sleep(Duration::from_millis(50)); // let open() get into its sleep

        let start = Instant::now();
        let _ = manager.drain_open_streams();
        assert!(
            start.elapsed() < Duration::from_millis(200),
            "drain_open_streams blocked behind a slow open()"
        );
        opener.join().unwrap();
    }

    #[test]
    fn write_to_unknown_stream_errors() {
        let manager = NetworkManager::new(EventBus::new());
        let err = manager.write("nope", b"hi").unwrap_err();
        assert!(err.contains("not found"));
    }

    #[test]
    fn close_unknown_stream_errors() {
        let manager = NetworkManager::new(EventBus::new());
        let err = manager.close("nope").unwrap_err();
        assert!(err.contains("not found"));
    }

    #[test]
    fn close_all_on_empty_manager_does_nothing() {
        let manager = NetworkManager::new(EventBus::new());
        manager.close_all();
    }
}
