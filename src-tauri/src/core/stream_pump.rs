//! Shared reader→pump plumbing (ADR-004): every `DataStream` spawns its own
//! transport-facing reader thread, but they all funnel bytes through this
//! same pump-thread shape — drain an unbounded channel into the bounded
//! `RingBuffer` and fan out to `on_data` callbacks. Kept generic here so
//! serial, TCP client, and TCP server don't each reimplement it.

use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use crossbeam_channel::Receiver;

use super::data_stream::DataCallback;
use super::ring_buffer::RingBuffer;

pub fn spawn_pump_thread(
    rx: Receiver<Vec<u8>>,
    buffer: Arc<Mutex<RingBuffer>>,
    callbacks: Arc<Mutex<Vec<DataCallback>>>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        for chunk in rx {
            buffer.lock().unwrap().push_slice(&chunk);
            for cb in callbacks.lock().unwrap().iter_mut() {
                cb(&chunk);
            }
        }
    })
}
