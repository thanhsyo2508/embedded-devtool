//! Manages open TCP client/server and UDP connections (Tháng 6), publishing
//! the same `Event::PortOpened`/`PortClosed`/`Error`/`DataReceived` events
//! used by serial (ADR-003/004) onto the shared `EventBus` — Filters,
//! Triggers, Macro, the script engine, and the plotter all keep working
//! unmodified regardless of transport, since none of them are aware a
//! stream's id came from the network rather than a serial port.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::core::data_stream::DataStream;
use crate::core::event_bus::{Event, EventBus};
use crate::core::mqtt_stream::{MqttConfig, MqttStream};
use crate::core::net_stream::{TcpClientStream, TcpServerStream, UdpDataStream};
use crate::core::ws_stream::{WsClientStream, WsServerStream};

pub struct NetworkManager {
    streams: Mutex<HashMap<String, Box<dyn DataStream>>>,
    event_bus: EventBus,
}

impl NetworkManager {
    pub fn new(event_bus: EventBus) -> Self {
        Self {
            streams: Mutex::new(HashMap::new()),
            event_bus,
        }
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
        self.open(id, Box::new(UdpDataStream::new(local_port, remote)))
    }

    pub fn open_ws_client(&self, id: String, url: String) -> Result<(), String> {
        self.open(id, Box::new(WsClientStream::new(url)))
    }

    pub fn open_ws_server(&self, id: String, port: u16) -> Result<(), String> {
        self.open(id, Box::new(WsServerStream::new(port)))
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
            id,
            Box::new(MqttStream::new(MqttConfig {
                broker_host,
                broker_port,
                client_id,
                username,
                password,
                subscribe_topic,
                publish_topic,
            })),
        )
    }

    fn open(&self, id: String, mut stream: Box<dyn DataStream>) -> Result<(), String> {
        let mut streams = self.streams.lock().unwrap();
        if streams.contains_key(&id) {
            return Err(format!("stream id '{id}' is already open"));
        }
        match stream.open() {
            Ok(()) => {
                streams.insert(id.clone(), stream);
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
        let mut streams = self.streams.lock().unwrap();
        match streams.remove(id) {
            Some(mut stream) => {
                let _ = stream.close();
                self.event_bus.publish(Event::PortClosed {
                    stream_id: id.to_string(),
                });
                Ok(())
            }
            None => Err(format!("stream id '{id}' not found")),
        }
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut streams = self.streams.lock().unwrap();
        match streams.get_mut(id) {
            Some(stream) => stream.write(data).map_err(|e| e.to_string()),
            None => Err(format!("stream id '{id}' not found")),
        }
    }

    /// Drains buffered bytes for every open stream and cleans up (+reports)
    /// any whose connection dropped on its own — e.g. a TCP client whose
    /// peer closed the socket. Called on the same ~16ms tick as
    /// `PortManager::drain_open_ports`.
    pub fn drain_open_streams(&self) -> Vec<(String, Vec<u8>)> {
        let mut streams = self.streams.lock().unwrap();
        let mut out = Vec::new();
        let mut lost = Vec::new();
        for (id, stream) in streams.iter_mut() {
            if let Ok(bytes) = stream.read() {
                if !bytes.is_empty() {
                    out.push((id.clone(), bytes));
                }
            }
            if stream.connection_lost() {
                lost.push(id.clone());
            }
        }
        for id in lost {
            if let Some(mut stream) = streams.remove(&id) {
                let _ = stream.close();
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
        let mut streams = self.streams.lock().unwrap();
        for (id, mut stream) in streams.drain() {
            let _ = stream.close();
            self.event_bus.publish(Event::PortClosed { stream_id: id });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
