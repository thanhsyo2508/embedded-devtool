//! Synthetic throughput benchmark for the reader-thread -> channel ->
//! pump-thread -> ring-buffer pattern that `SerialStream` uses. Runs
//! entirely in-process (no serial hardware needed) so it can validate the
//! *architecture* choice (unbounded channel decoupling OS read from
//! consumer work) before testing against real hardware.
//!
//! This is a stand-in for G0-T4's hardware benchmark, which additionally
//! requires a physical USB-UART adapter — see `examples/serial_loopback_benchmark.rs`
//! for that one.
//!
//! Usage: cargo run --release --example pipeline_benchmark [bytes_per_sec] [duration_secs]
//! Defaults: 250000 B/s (~2 Mbps), 60s. Watch this process's CPU in Task
//! Manager / htop while it runs — the target from the plan is <15%.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crossbeam_channel::unbounded;
use edt_lib::core::ring_buffer::RingBuffer;

fn main() {
    let target_bytes_per_sec: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(250_000);
    let duration_secs: u64 = std::env::args()
        .nth(2)
        .and_then(|s| s.parse().ok())
        .unwrap_or(60);

    println!(
        "target={target_bytes_per_sec} B/s (~{:.2} Mbps), duration={duration_secs}s",
        target_bytes_per_sec as f64 * 8.0 / 1_000_000.0
    );
    println!("Watch this process's CPU usage in Task Manager / htop during the run.\n");

    let (tx, rx) = unbounded::<Vec<u8>>();
    let buffer = Arc::new(Mutex::new(RingBuffer::new(1 << 20)));
    let received_bytes = Arc::new(AtomicU64::new(0));
    let stop_flag = Arc::new(AtomicBool::new(false));

    let buffer_for_pump = buffer.clone();
    let received_for_pump = received_bytes.clone();
    let pump = thread::spawn(move || {
        for chunk in rx {
            received_for_pump.fetch_add(chunk.len() as u64, Ordering::Relaxed);
            buffer_for_pump.lock().unwrap().push_slice(&chunk);
        }
    });

    let sent_bytes = Arc::new(AtomicU64::new(0));
    let sent_for_producer = sent_bytes.clone();
    let stop_flag_for_producer = stop_flag.clone();
    let producer = thread::spawn(move || {
        const CHUNK_SIZE: usize = 4096;
        let chunk_interval =
            Duration::from_secs_f64(CHUNK_SIZE as f64 / target_bytes_per_sec as f64);
        let mut buf = [0u8; CHUNK_SIZE];
        let mut seq: u8 = 0;
        while !stop_flag_for_producer.load(Ordering::Relaxed) {
            for b in buf.iter_mut() {
                *b = seq;
                seq = seq.wrapping_add(1);
            }
            if tx.send(buf.to_vec()).is_err() {
                break;
            }
            sent_for_producer.fetch_add(CHUNK_SIZE as u64, Ordering::Relaxed);
            thread::sleep(chunk_interval);
        }
        // tx dropped here as the thread exits, which closes the channel and
        // lets the pump thread's `for chunk in rx` loop end naturally.
    });

    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(duration_secs) {
        thread::sleep(Duration::from_secs(1));
        println!(
            "t={:>4}s sent={:>10} recv={:>10} ring_buffered={:>8}",
            start.elapsed().as_secs(),
            sent_bytes.load(Ordering::Relaxed),
            received_bytes.load(Ordering::Relaxed),
            buffer.lock().unwrap().len(),
        );
    }

    stop_flag.store(true, Ordering::Relaxed);
    producer.join().expect("producer thread panicked");
    pump.join().expect("pump thread panicked");

    let sent = sent_bytes.load(Ordering::Relaxed);
    let recv = received_bytes.load(Ordering::Relaxed);
    println!("\n=== Result ===");
    println!("sent:     {sent} bytes");
    println!("received: {recv} bytes");
    if sent == recv {
        println!("0 byte drop (pump kept up with producer)");
    } else {
        println!("DROP DETECTED: {} bytes lost", sent - recv);
        std::process::exit(1);
    }
}
