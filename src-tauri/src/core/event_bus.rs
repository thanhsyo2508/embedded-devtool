//! Pub/sub event bus (ADR-003). Modules publish `Event`s here instead of
//! calling each other directly, so new modules (TCP/UDP, MQTT, script engine)
//! can be added later without touching existing ones.

use std::sync::{Arc, Mutex};

use crossbeam_channel::{unbounded, Receiver, Sender};

#[derive(Debug, Clone)]
pub enum Event {
    PortOpened {
        stream_id: String,
    },
    PortClosed {
        stream_id: String,
    },
    /// Raw bytes received from a stream, batched by the producer (not one
    /// event per byte/line) to keep the bus cheap under high throughput.
    DataReceived {
        stream_id: String,
        data: Arc<[u8]>,
    },
    Error {
        stream_id: String,
        message: String,
    },
    /// A single MQTT PUBLISH received on a subscribed topic. Carries
    /// structured metadata (topic/qos/retain) that `DataReceived`'s opaque
    /// bytes can't — the topic-based UI reads this instead of parsing the
    /// synthetic "{topic}: {payload}" text lines `DataReceived` still gets
    /// for backward compatibility with filters/triggers/scripts.
    MqttMessage {
        stream_id: String,
        topic: String,
        payload: Arc<[u8]>,
        qos: u8,
        retain: bool,
    },
    /// One UDP datagram, tagged with its sender address — `DataReceived`
    /// concatenates all datagrams into one opaque byte stream, losing both
    /// the per-packet boundary and who sent it, neither of which a
    /// connectionless protocol's UI should have to give up.
    UdpDatagram {
        stream_id: String,
        from: String,
        data: Arc<[u8]>,
    },
    /// One WebSocket message, tagged with its frame kind — `DataReceived`
    /// flattens Text and Binary frames into the same byte stream (and
    /// newline-terminates Text), losing the distinction a WS-aware UI needs.
    WsFrame {
        stream_id: String,
        kind: WsFrameKind,
        data: Arc<[u8]>,
    },
    /// A USB serial device was newly enumerated by the OS (plugged in),
    /// detected by polling `available_ports()` and diffing by VID/PID/serial
    /// — see `serial::manager::spawn_hotplug_watcher`. Independent of
    /// `PortManager`'s open/closed port state; fires for any USB serial
    /// device, not just ones the app has opened before.
    UsbPlugged {
        port_name: String,
        vid: Option<u16>,
        pid: Option<u16>,
        serial_number: Option<String>,
        manufacturer: Option<String>,
        product: Option<String>,
    },
    /// The counterpart to `UsbPlugged` — a previously-seen USB serial device
    /// disappeared from the port list.
    UsbUnplugged {
        port_name: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WsFrameKind {
    Text,
    Binary,
}

#[derive(Default, Clone)]
pub struct EventBus {
    subscribers: Arc<Mutex<Vec<Sender<Event>>>>,
}

impl EventBus {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn subscribe(&self) -> Receiver<Event> {
        let (tx, rx) = unbounded();
        self.subscribers.lock().unwrap().push(tx);
        rx
    }

    /// Sends `event` to every current subscriber. Dead subscribers (receiver
    /// dropped) are pruned lazily on the next publish.
    pub fn publish(&self, event: Event) {
        let mut subs = self.subscribers.lock().unwrap();
        subs.retain(|tx| tx.send(event.clone()).is_ok());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn broadcasts_to_all_subscribers() {
        let bus = EventBus::new();
        let rx_a = bus.subscribe();
        let rx_b = bus.subscribe();

        bus.publish(Event::PortOpened {
            stream_id: "COM3".into(),
        });

        assert!(matches!(rx_a.recv().unwrap(), Event::PortOpened { .. }));
        assert!(matches!(rx_b.recv().unwrap(), Event::PortOpened { .. }));
    }

    #[test]
    fn drops_dead_subscribers_without_blocking_publish() {
        let bus = EventBus::new();
        {
            let _rx = bus.subscribe(); // dropped immediately
        }
        bus.publish(Event::PortClosed {
            stream_id: "COM3".into(),
        });
        assert_eq!(bus.subscribers.lock().unwrap().len(), 0);
    }
}
