//! MQTT client `DataStream` implementation (Tháng 6). Uses rumqttc's
//! synchronous `Client`/`Connection` API (not `AsyncClient`/`EventLoop`) so
//! this module stays free of async/await, even though rumqttc uses tokio
//! internally under the hood. `DataStream` is a raw-byte-stream abstraction
//! with no per-message metadata channel, so each incoming publish is
//! formatted as a `"{topic}: {payload}\n"` text line and fed through the
//! same pump-thread/ring-buffer path as the other transports.
//!
//! rumqttc's `Connection` reconnects automatically as long as it keeps
//! being polled (see its docs), so a connection error here is reported as a
//! line in the stream rather than as `connection_lost` — unlike TCP, losing
//! the broker isn't fatal, and tearing the stream down would fight the
//! library's own retry loop.

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crossbeam_channel::{unbounded, Receiver, Sender};
use rumqttc::{
    Client, ConnectReturnCode, Event as MqttEvent, MqttOptions, Packet, QoS, RecvTimeoutError,
};

use super::data_stream::{DataCallback, DataStream};
use super::event_bus::{Event as CoreEvent, EventBus};
use super::ring_buffer::RingBuffer;
use super::stream_pump::spawn_pump_thread;

const RING_BUFFER_CAPACITY: usize = 1 << 20;
/// How often the poll thread wakes up to re-check the stop flag, and how
/// long it backs off after a connection error before rumqttc retries.
const POLL_TIMEOUT: Duration = Duration::from_millis(200);
/// How long `open()` blocks waiting for the broker's CONNACK before giving
/// up. Without this, `Client::new` + `subscribe()` return immediately no
/// matter whether the broker is even reachable — the caller would see a
/// successful connect and land in the terminal against a stream that's
/// silently retrying forever in the background.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

pub struct MqttConfig {
    pub broker_host: String,
    pub broker_port: u16,
    pub client_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub subscribe_topic: String,
    pub publish_topic: String,
}

pub struct MqttStream {
    stream_id: String,
    event_bus: EventBus,
    config: MqttConfig,
    client: Option<Client>,
    poll_thread: Option<JoinHandle<()>>,
    pump_thread: Option<JoinHandle<()>>,
    stop_flag: Arc<AtomicBool>,
    buffer: Arc<Mutex<RingBuffer>>,
    callbacks: Arc<Mutex<Vec<DataCallback>>>,
}

impl MqttStream {
    pub fn new(stream_id: String, event_bus: EventBus, config: MqttConfig) -> Self {
        Self {
            stream_id,
            event_bus,
            config,
            client: None,
            poll_thread: None,
            pump_thread: None,
            stop_flag: Arc::new(AtomicBool::new(false)),
            buffer: Arc::new(Mutex::new(RingBuffer::new(RING_BUFFER_CAPACITY))),
            callbacks: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

fn qos_to_u8(qos: QoS) -> u8 {
    match qos {
        QoS::AtMostOnce => 0,
        QoS::AtLeastOnce => 1,
        QoS::ExactlyOnce => 2,
    }
}

fn u8_to_qos(qos: u8) -> QoS {
    match qos {
        1 => QoS::AtLeastOnce,
        2 => QoS::ExactlyOnce,
        _ => QoS::AtMostOnce,
    }
}

impl DataStream for MqttStream {
    fn open(&mut self) -> io::Result<()> {
        if self.client.is_some() {
            return Ok(());
        }

        let mut options = MqttOptions::new(
            &self.config.client_id,
            &self.config.broker_host,
            self.config.broker_port,
        );
        options.set_keep_alive(Duration::from_secs(30));
        if let (Some(username), Some(password)) = (&self.config.username, &self.config.password) {
            options.set_credentials(username, password);
        }

        let (client, mut connection) = Client::new(options, 64);
        client
            .subscribe(&self.config.subscribe_topic, QoS::AtMostOnce)
            .map_err(io::Error::other)?;

        // Block until the broker actually acknowledges the connection (or
        // rejects/times out) so a bad host/port/credentials surfaces as a
        // real error to the caller instead of a silent background retry.
        let deadline = std::time::Instant::now() + CONNECT_TIMEOUT;
        loop {
            if std::time::Instant::now() >= deadline {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "timed out waiting for the broker to respond",
                ));
            }
            match connection.recv_timeout(POLL_TIMEOUT) {
                Ok(Ok(MqttEvent::Incoming(Packet::ConnAck(ack)))) => {
                    if ack.code != ConnectReturnCode::Success {
                        return Err(io::Error::other(format!(
                            "broker refused connection: {:?}",
                            ack.code
                        )));
                    }
                    break;
                }
                Ok(Ok(_)) => {}
                Ok(Err(e)) => return Err(io::Error::other(e.to_string())),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(io::Error::other(
                        "connection closed before the broker responded",
                    ))
                }
            }
        }

        let (tx, rx): (Sender<Vec<u8>>, Receiver<Vec<u8>>) = unbounded();
        self.stop_flag.store(false, Ordering::SeqCst);
        let stop_flag = self.stop_flag.clone();
        let stream_id = self.stream_id.clone();
        let event_bus = self.event_bus.clone();

        self.poll_thread = Some(thread::spawn(move || {
            let mut erroring = false;
            while !stop_flag.load(Ordering::Relaxed) {
                match connection.recv_timeout(POLL_TIMEOUT) {
                    Ok(Ok(MqttEvent::Incoming(Packet::Publish(publish)))) => {
                        let line = format!(
                            "{}: {}\n",
                            publish.topic,
                            String::from_utf8_lossy(&publish.payload)
                        );
                        if tx.send(line.into_bytes()).is_err() {
                            break; // pump thread gone, stream closed
                        }
                        event_bus.publish(CoreEvent::MqttMessage {
                            stream_id: stream_id.clone(),
                            topic: publish.topic,
                            payload: Arc::from(publish.payload.as_ref()),
                            qos: qos_to_u8(publish.qos),
                            retain: publish.retain,
                        });
                    }
                    Ok(Ok(MqttEvent::Incoming(Packet::ConnAck(_)))) => {
                        if erroring {
                            erroring = false;
                            let _ = tx.send(b"[mqtt] reconnected\n".to_vec());
                        }
                    }
                    Ok(Ok(_)) => {}
                    Ok(Err(e)) => {
                        if !erroring {
                            erroring = true;
                            let _ = tx.send(format!("[mqtt] connection error: {e}\n").into_bytes());
                        }
                        thread::sleep(POLL_TIMEOUT);
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        }));

        self.pump_thread = Some(spawn_pump_thread(
            rx,
            self.buffer.clone(),
            self.callbacks.clone(),
        ));
        self.client = Some(client);
        Ok(())
    }

    fn close(&mut self) -> io::Result<()> {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(client) = self.client.take() {
            let _ = client.disconnect();
        }
        if let Some(handle) = self.poll_thread.take() {
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
        match self.client.as_ref() {
            Some(client) => client
                .publish(&self.config.publish_topic, QoS::AtMostOnce, false, data)
                .map_err(io::Error::other),
            None => Err(io::Error::new(io::ErrorKind::NotConnected, "not connected")),
        }
    }

    fn on_data(&mut self, callback: DataCallback) {
        self.callbacks.lock().unwrap().push(callback);
    }

    fn publish(&mut self, topic: &str, payload: &[u8], qos: u8, retain: bool) -> io::Result<()> {
        match self.client.as_ref() {
            Some(client) => client
                .publish(topic, u8_to_qos(qos), retain, payload)
                .map_err(io::Error::other),
            None => Err(io::Error::new(io::ErrorKind::NotConnected, "not connected")),
        }
    }

    fn subscribe(&mut self, topic: &str, qos: u8) -> io::Result<()> {
        match self.client.as_ref() {
            Some(client) => client
                .subscribe(topic, u8_to_qos(qos))
                .map_err(io::Error::other),
            None => Err(io::Error::new(io::ErrorKind::NotConnected, "not connected")),
        }
    }

    fn unsubscribe(&mut self, topic: &str) -> io::Result<()> {
        match self.client.as_ref() {
            Some(client) => client.unsubscribe(topic).map_err(io::Error::other),
            None => Err(io::Error::new(io::ErrorKind::NotConnected, "not connected")),
        }
    }

    fn is_open(&self) -> bool {
        self.client.is_some()
    }
}
