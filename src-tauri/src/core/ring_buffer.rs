//! Fixed-capacity byte ring buffer. Producer (reader thread) pushes as fast
//! as the transport delivers data; oldest bytes are evicted once `capacity`
//! is exceeded so memory stays bounded regardless of session length. This is
//! the buffer the plan (§2.2.3) means by "ring buffer phía Rust" — a bound on
//! *retained* data, not a mechanism that can lose *incoming* data (see
//! `SerialStream`, which uses an unbounded channel between the OS read loop
//! and this buffer so ingestion is never blocked by capacity here).

use std::collections::VecDeque;

pub struct RingBuffer {
    capacity: usize,
    data: VecDeque<u8>,
}

impl RingBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            data: VecDeque::with_capacity(capacity.min(1 << 20)),
        }
    }

    pub fn push_slice(&mut self, bytes: &[u8]) {
        self.data.extend(bytes);
        let overflow = self.data.len().saturating_sub(self.capacity);
        if overflow > 0 {
            self.data.drain(..overflow);
        }
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    /// Drains and returns all currently buffered bytes.
    pub fn drain_all(&mut self) -> Vec<u8> {
        self.data.drain(..).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evicts_oldest_when_over_capacity() {
        let mut buf = RingBuffer::new(4);
        buf.push_slice(b"ABCD");
        buf.push_slice(b"EF");
        assert_eq!(buf.drain_all(), b"CDEF");
    }

    #[test]
    fn drain_all_empties_buffer() {
        let mut buf = RingBuffer::new(16);
        buf.push_slice(b"hello");
        assert_eq!(buf.drain_all(), b"hello");
        assert!(buf.is_empty());
    }
}
