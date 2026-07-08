//! `DataStream` (ADR-004): the common interface for every data source
//! (serial, TCP, UDP, MQTT, file replay). Monitor, plotter, and the script
//! engine only ever talk to this trait — never to a concrete transport —
//! so adding a new source later doesn't touch existing consumers.

use std::io;

pub type DataCallback = Box<dyn FnMut(&[u8]) + Send>;

pub trait DataStream: Send {
    /// Opens the underlying transport. Idempotent if already open.
    fn open(&mut self) -> io::Result<()>;

    /// Closes the transport and stops any background reader.
    fn close(&mut self) -> io::Result<()>;

    /// Drains and returns bytes buffered since the last call. Non-blocking;
    /// returns an empty vec if nothing is available. Used by pull-style
    /// consumers (e.g. the scripting engine's `wait_for`).
    fn read(&mut self) -> io::Result<Vec<u8>>;

    /// Writes bytes to the transport.
    fn write(&mut self, data: &[u8]) -> io::Result<()>;

    /// Registers a push-style callback invoked from the stream's reader
    /// thread as data arrives. Used by the ring buffer / event bus bridge
    /// so the UI gets data without polling.
    fn on_data(&mut self, callback: DataCallback);

    fn is_open(&self) -> bool;

    /// Publishes to an arbitrary topic with explicit QoS/retain, bypassing
    /// the configured default publish topic passed to `write`. Only MQTT
    /// implements this; every other transport has no notion of topics, so
    /// the default is a plain error rather than a silent no-op.
    fn publish(&mut self, _topic: &str, _payload: &[u8], _qos: u8, _retain: bool) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "this stream does not support topic-based publish",
        ))
    }

    /// Adds a subscription beyond the one topic configured at connect time.
    /// Only MQTT implements this.
    fn subscribe(&mut self, _topic: &str, _qos: u8) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "this stream does not support subscribe",
        ))
    }

    /// Removes a subscription previously added via `subscribe` (or the
    /// initial connect-time one). Only MQTT implements this.
    fn unsubscribe(&mut self, _topic: &str) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "this stream does not support unsubscribe",
        ))
    }

    /// Sends a WebSocket Text frame instead of `write`'s always-Binary
    /// frame. Only the WS streams implement this — every other transport
    /// has no frame-kind concept to preserve.
    fn send_text(&mut self, _text: &str) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "this stream does not support text frames",
        ))
    }

    /// Tells the remote end the terminal size changed. Only SSH implements
    /// this (a PTY window-change request) — every other transport has no
    /// notion of terminal dimensions.
    fn resize(&mut self, _cols: u32, _rows: u32) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "this stream does not support resizing",
        ))
    }

    /// True if the transport observed itself go from open to broken (e.g. a
    /// TCP peer closing the connection) without an explicit `close()` call.
    /// Lets a manager notice and clean up without a transport-specific poll
    /// like serial's USB reconnect watcher. Default false: most
    /// implementations either can't detect this (serial) or don't consider
    /// it an error (a TCP server between clients).
    fn connection_lost(&self) -> bool {
        false
    }
}
