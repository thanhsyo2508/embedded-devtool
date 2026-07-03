//! `SerialStream`: first `DataStream` implementation. One dedicated OS thread
//! per open port reads in a tight loop and pushes bytes downstream through an
//! unbounded channel — the thread never blocks on what the consumer does
//! with the data, which is what keeps the OS-level serial buffer from
//! overflowing at high baud rates (see G0-T4 benchmark).

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crossbeam_channel::{unbounded, Receiver, Sender};
use serialport::{DataBits, FlowControl, Parity, StopBits};

use super::data_stream::{DataCallback, DataStream};
use super::ring_buffer::RingBuffer;

#[derive(Debug, Clone)]
pub struct SerialConfig {
    pub port_name: String,
    pub baud_rate: u32,
    pub data_bits: DataBits,
    pub parity: Parity,
    pub stop_bits: StopBits,
    pub flow_control: FlowControl,
    /// How long the reader thread blocks per `read()` call before checking
    /// the stop flag again. Small values make `close()` responsive; they do
    /// not throttle throughput since the OS still delivers bytes as soon as
    /// they arrive.
    pub read_timeout: Duration,
    /// Bytes retained for pull-style `read()` / display. Ingestion is never
    /// blocked by this — see module docs.
    pub buffer_capacity: usize,
}

impl SerialConfig {
    pub fn new(port_name: impl Into<String>, baud_rate: u32) -> Self {
        Self {
            port_name: port_name.into(),
            baud_rate,
            data_bits: DataBits::Eight,
            parity: Parity::None,
            stop_bits: StopBits::One,
            flow_control: FlowControl::None,
            read_timeout: Duration::from_millis(10),
            buffer_capacity: 1 << 20, // 1 MiB
        }
    }
}

pub struct SerialStream {
    config: SerialConfig,
    port: Option<Box<dyn serialport::SerialPort>>,
    reader_thread: Option<JoinHandle<()>>,
    pump_thread: Option<JoinHandle<()>>,
    stop_flag: Arc<AtomicBool>,
    buffer: Arc<Mutex<RingBuffer>>,
    callbacks: Arc<Mutex<Vec<DataCallback>>>,
}

impl SerialStream {
    pub fn new(config: SerialConfig) -> Self {
        let capacity = config.buffer_capacity;
        Self {
            config,
            port: None,
            reader_thread: None,
            pump_thread: None,
            stop_flag: Arc::new(AtomicBool::new(false)),
            buffer: Arc::new(Mutex::new(RingBuffer::new(capacity))),
            callbacks: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Bytes currently retained in the display/read buffer (not a measure of
    /// total bytes received — see `RingBuffer`).
    pub fn buffered_len(&self) -> usize {
        self.buffer.lock().unwrap().len()
    }
}

impl DataStream for SerialStream {
    fn open(&mut self) -> io::Result<()> {
        if self.port.is_some() {
            return Ok(());
        }

        let port = serialport::new(&self.config.port_name, self.config.baud_rate)
            .data_bits(self.config.data_bits)
            .parity(self.config.parity)
            .stop_bits(self.config.stop_bits)
            .flow_control(self.config.flow_control)
            .timeout(self.config.read_timeout)
            .open()
            .map_err(io::Error::other)?;

        let mut reader_port = port.try_clone().map_err(io::Error::other)?;
        self.port = Some(port);

        let (tx, rx): (Sender<Vec<u8>>, Receiver<Vec<u8>>) = unbounded();

        self.stop_flag.store(false, Ordering::SeqCst);
        let stop_flag = self.stop_flag.clone();

        // Reader thread: only talks to the OS and the channel. It must never
        // do buffer/callback work itself, or a slow consumer would stall the
        // OS read loop and risk overflowing the driver's own buffer.
        self.reader_thread = Some(thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while !stop_flag.load(Ordering::Relaxed) {
                match reader_port.read(&mut buf) {
                    Ok(0) => continue,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break; // pump thread gone, stream closed
                        }
                    }
                    Err(ref e) if e.kind() == io::ErrorKind::TimedOut => continue,
                    Err(_) => continue, // transient error; keep reading until close()
                }
            }
        }));

        // Pump thread: drains the channel into the ring buffer and fans out
        // to callbacks. Exits automatically once the reader thread drops
        // `tx` (i.e. after close()).
        let buffer = self.buffer.clone();
        let callbacks = self.callbacks.clone();
        self.pump_thread = Some(thread::spawn(move || {
            for chunk in rx {
                buffer.lock().unwrap().push_slice(&chunk);
                for cb in callbacks.lock().unwrap().iter_mut() {
                    cb(&chunk);
                }
            }
        }));

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
        self.port = None;
        Ok(())
    }

    fn read(&mut self) -> io::Result<Vec<u8>> {
        Ok(self.buffer.lock().unwrap().drain_all())
    }

    fn write(&mut self, data: &[u8]) -> io::Result<()> {
        match self.port.as_mut() {
            Some(port) => port.write_all(data),
            None => Err(io::Error::new(io::ErrorKind::NotConnected, "port not open")),
        }
    }

    fn on_data(&mut self, callback: DataCallback) {
        self.callbacks.lock().unwrap().push(callback);
    }

    fn is_open(&self) -> bool {
        self.port.is_some()
    }
}

/// Enumerates available serial ports with USB metadata (VID/PID, product
/// name, serial number) where the OS provides it — feeds M1-T1.1 (port
/// manager) and M1-T1.5 (auto-reconnect matching).
pub fn list_ports() -> io::Result<Vec<serialport::SerialPortInfo>> {
    serialport::available_ports().map_err(io::Error::other)
}
