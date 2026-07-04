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
use super::stream_pump::spawn_pump_thread;

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
    /// RS485 half-duplex direction control: toggle RTS (wired to a
    /// transceiver's DE/RE pin on hardware that has no auto-direction
    /// circuitry) around each write. See `write()` for the guard-delay
    /// rationale.
    pub rs485_auto_rts: bool,
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
            rs485_auto_rts: false,
        }
    }
}

/// How many bit-times one byte occupies on the wire (start + data + parity +
/// stop bits) — needed to compute how long to hold RTS asserted after a
/// write so the last byte(s) finish shifting out before switching the
/// transceiver back to receive.
fn bits_per_byte(data_bits: DataBits, parity: Parity, stop_bits: StopBits) -> u32 {
    let data = match data_bits {
        DataBits::Five => 5,
        DataBits::Six => 6,
        DataBits::Seven => 7,
        DataBits::Eight => 8,
    };
    let parity_bit = match parity {
        Parity::None => 0,
        Parity::Odd | Parity::Even => 1,
    };
    let stop = match stop_bits {
        StopBits::One => 1,
        StopBits::Two => 2,
    };
    1 + data + parity_bit + stop
}

/// `write_all` on a USB-serial adapter returns once bytes are handed to the
/// OS/driver, not once they've physically finished shifting out — dropping
/// RTS immediately after would clip the last byte(s) on real RS485
/// hardware. This computes that transmit time from the actual baud
/// rate/framing instead of guessing a fixed delay.
fn tx_duration(byte_count: usize, baud_rate: u32, bits_per_byte: u32) -> Duration {
    Duration::from_secs_f64(byte_count as f64 * bits_per_byte as f64 / baud_rate as f64)
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

        // Pump thread (shared shape, see core::stream_pump): drains the
        // channel into the ring buffer and fans out to callbacks. Exits
        // automatically once the reader thread drops `tx` (i.e. after
        // close()).
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
        self.port = None;
        Ok(())
    }

    fn read(&mut self) -> io::Result<Vec<u8>> {
        Ok(self.buffer.lock().unwrap().drain_all())
    }

    fn write(&mut self, data: &[u8]) -> io::Result<()> {
        match self.port.as_mut() {
            Some(port) => {
                if !self.config.rs485_auto_rts {
                    return port.write_all(data);
                }
                port.write_request_to_send(true).map_err(io::Error::other)?;
                let result = port.write_all(data);
                let guard = tx_duration(
                    data.len(),
                    self.config.baud_rate,
                    bits_per_byte(
                        self.config.data_bits,
                        self.config.parity,
                        self.config.stop_bits,
                    ),
                );
                thread::sleep(guard);
                port.write_request_to_send(false)
                    .map_err(io::Error::other)?;
                result
            }
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

/// Live state of the RS-232 control lines. `cts`/`dsr`/`ri`/`cd` are inputs
/// read from the device; DTR/RTS are outputs this side drives (see
/// `SerialStream::set_dtr`/`set_rts`) — surfaced separately from `DataStream`
/// since they're serial-specific, not part of the transport-agnostic trait.
#[derive(Debug, Clone, Copy, Default)]
pub struct SignalState {
    pub cts: bool,
    pub dsr: bool,
    pub ri: bool,
    pub cd: bool,
}

impl SerialStream {
    /// Sets the Data Terminal Ready line. Commonly toggled together with RTS
    /// to trigger an auto-reset-into-bootloader sequence on ESP32/Arduino
    /// boards wired with the classic DTR/RTS reset circuit.
    pub fn set_dtr(&mut self, level: bool) -> io::Result<()> {
        match self.port.as_mut() {
            Some(port) => port
                .write_data_terminal_ready(level)
                .map_err(io::Error::other),
            None => Err(io::Error::new(io::ErrorKind::NotConnected, "port not open")),
        }
    }

    pub fn set_rts(&mut self, level: bool) -> io::Result<()> {
        match self.port.as_mut() {
            Some(port) => port.write_request_to_send(level).map_err(io::Error::other),
            None => Err(io::Error::new(io::ErrorKind::NotConnected, "port not open")),
        }
    }

    pub fn read_signals(&mut self) -> io::Result<SignalState> {
        match self.port.as_mut() {
            Some(port) => Ok(SignalState {
                cts: port.read_clear_to_send().map_err(io::Error::other)?,
                dsr: port.read_data_set_ready().map_err(io::Error::other)?,
                ri: port.read_ring_indicator().map_err(io::Error::other)?,
                cd: port.read_carrier_detect().map_err(io::Error::other)?,
            }),
            None => Err(io::Error::new(io::ErrorKind::NotConnected, "port not open")),
        }
    }
}

/// Enumerates available serial ports with USB metadata (VID/PID, product
/// name, serial number) where the OS provides it — feeds M1-T1.1 (port
/// manager) and M1-T1.5 (auto-reconnect matching).
pub fn list_ports() -> io::Result<Vec<serialport::SerialPortInfo>> {
    serialport::available_ports().map_err(io::Error::other)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bits_per_byte_counts_start_data_parity_stop() {
        assert_eq!(
            bits_per_byte(DataBits::Eight, Parity::None, StopBits::One),
            10
        );
        assert_eq!(
            bits_per_byte(DataBits::Eight, Parity::Even, StopBits::Two),
            12
        );
        assert_eq!(
            bits_per_byte(DataBits::Seven, Parity::Odd, StopBits::One),
            10
        );
    }

    #[test]
    fn tx_duration_matches_known_baud_rate() {
        // 8 bytes @ 9600 baud, 10 bits/byte (8N1) ~= 8.33ms.
        let d = tx_duration(8, 9600, 10);
        assert!((d.as_secs_f64() - 0.008_333_333_333_333_333).abs() < 1e-9);
    }
}
