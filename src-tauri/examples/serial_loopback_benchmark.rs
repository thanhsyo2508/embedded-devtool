//! G0-T4 hardware benchmark: exercises the real `SerialStream` against a
//! physical USB-UART adapter with TX and RX pins bridged (a wire jumper
//! between the TX and RX pins on the adapter, or between two adapters
//! wired TX->RX/RX->TX). Everything written is expected to be read back
//! byte-for-byte, so this needs no target firmware.
//!
//! Setup: pick a USB-UART adapter (CP210x, CH340, or FTDI per the plan's
//! risk list), bridge its TX and RX lines, plug it in, find its port name.
//!
//! Usage:
//!   cargo run --release --example serial_loopback_benchmark -- <PORT> [baud] [duration_secs]
//!   cargo run --release --example serial_loopback_benchmark -- COM5 2000000 600
//!
//! DoD from the plan: 10 minutes continuous at 2 Mbps, 0 byte drop, CPU <15%
//! (check Task Manager / htop for the CPU figure while this runs).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use edt_lib::core::data_stream::DataStream;
use edt_lib::core::serial_stream::{SerialConfig, SerialStream};

fn main() {
    let mut args = std::env::args().skip(1);
    let port_name = args.next().unwrap_or_else(|| {
        eprintln!("usage: serial_loopback_benchmark <PORT> [baud=2000000] [duration_secs=600]");
        eprintln!("available ports:");
        for p in edt_lib::core::serial_stream::list_ports().unwrap_or_default() {
            eprintln!("  {}", p.port_name);
        }
        std::process::exit(1);
    });
    let baud_rate: u32 = args
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(2_000_000);
    let duration_secs: u64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(600);

    println!("port={port_name} baud={baud_rate} duration={duration_secs}s");
    println!("Requires TX/RX physically bridged on this adapter (loopback).");
    println!("Watch this process's CPU usage in Task Manager / htop during the run.\n");

    let config = SerialConfig::new(&port_name, baud_rate);
    let mut stream = SerialStream::new(config);
    stream.open().expect("failed to open port");

    let received_bytes = Arc::new(AtomicU64::new(0));
    let mismatches = Arc::new(AtomicU64::new(0));
    let expected_next = Arc::new(std::sync::Mutex::new(0u8));

    {
        let received_bytes = received_bytes.clone();
        let mismatches = mismatches.clone();
        let expected_next = expected_next.clone();
        stream.on_data(Box::new(move |chunk: &[u8]| {
            received_bytes.fetch_add(chunk.len() as u64, Ordering::Relaxed);
            let mut expected = expected_next.lock().unwrap();
            for &b in chunk {
                if b != *expected {
                    mismatches.fetch_add(1, Ordering::Relaxed);
                    *expected = b; // resync so one mismatch doesn't cascade into all
                }
                *expected = expected.wrapping_add(1);
            }
        }));
    }

    let sent_bytes = Arc::new(AtomicU64::new(0));
    let stop_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let writer_handle = {
        let sent_bytes = sent_bytes.clone();
        let stop_flag = stop_flag.clone();
        // SerialStream::write requires &mut self, so we can't share `stream`
        // across threads directly; instead reopen a second handle to the
        // same port name for writing. (Most USB-UART drivers allow this on
        // Windows/Linux; if the OS refuses, run a separate loopback writer.)
        let write_config = SerialConfig::new(&port_name, baud_rate);
        let mut writer_stream = SerialStream::new(write_config);
        thread::spawn(move || {
            writer_stream
                .open()
                .expect("failed to open port for writing");
            const CHUNK_SIZE: usize = 1024;
            let mut buf = [0u8; CHUNK_SIZE];
            let mut seq: u8 = 0;
            while !stop_flag.load(Ordering::Relaxed) {
                for b in buf.iter_mut() {
                    *b = seq;
                    seq = seq.wrapping_add(1);
                }
                if writer_stream.write(&buf).is_ok() {
                    sent_bytes.fetch_add(CHUNK_SIZE as u64, Ordering::Relaxed);
                }
            }
            let _ = writer_stream.close();
        })
    };

    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(duration_secs) {
        thread::sleep(Duration::from_secs(1));
        println!(
            "t={:>4}s sent={:>10} recv={:>10} mismatches={:>6}",
            start.elapsed().as_secs(),
            sent_bytes.load(Ordering::Relaxed),
            received_bytes.load(Ordering::Relaxed),
            mismatches.load(Ordering::Relaxed),
        );
    }

    stop_flag.store(true, Ordering::Relaxed);
    writer_handle.join().expect("writer thread panicked");
    thread::sleep(Duration::from_millis(200)); // let in-flight bytes drain
    stream.close().expect("failed to close port");

    let sent = sent_bytes.load(Ordering::Relaxed);
    let recv = received_bytes.load(Ordering::Relaxed);
    let bad = mismatches.load(Ordering::Relaxed);
    println!("\n=== Result ===");
    println!("sent:       {sent} bytes");
    println!("received:   {recv} bytes");
    println!("mismatches: {bad}");
    if bad == 0 && recv >= sent.saturating_sub(CHUNK_TAIL_TOLERANCE) {
        println!("PASS");
    } else {
        println!("FAIL — check wiring, driver, or reduce baud rate");
        std::process::exit(1);
    }
}

/// A handful of bytes still in flight when the writer stops is expected, not
/// a drop — only flag a failure if the shortfall is larger than that.
const CHUNK_TAIL_TOLERANCE: u64 = 4096;
