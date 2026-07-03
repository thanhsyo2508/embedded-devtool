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
