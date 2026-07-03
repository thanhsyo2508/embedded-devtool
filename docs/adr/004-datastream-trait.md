# ADR-004: `DataStream` abstraction + `SerialStream` reader architecture

- Status: Accepted
- Date: 2026-07-03

## Context

Main plan §2.2.2 requires monitor and plotter to work identically regardless
of whether data comes from serial, TCP, UDP, MQTT, or file replay. §2.2.3
requires high-speed data to be buffered in Rust and sent to the frontend in
batches, not per byte/line — the thing G0-T4 benchmarks.

## Decision

`trait DataStream` (`src-tauri/src/core/data_stream.rs`) with `open / close /
read / write / on_data / is_open`, matching the plan's stated interface:

- `read()` is a non-blocking drain of buffered bytes — for pull consumers
  (planned use: script engine's `wait_for`, CLI mode).
- `on_data(callback)` registers a push callback invoked from a background
  thread as data arrives — for the ring buffer / event bus bridge that feeds
  the UI.

`SerialStream` (`src-tauri/src/core/serial_stream.rs`) is the first
implementation, using **two threads per open port**:

1. **Reader thread** — only calls `port.read()` and forwards raw chunks
   through an unbounded `crossbeam_channel`. It does nothing else: no
   parsing, no buffer writes, no callback invocation.
2. **Pump thread** — drains that channel into the bounded `RingBuffer` and
   fans out to registered `on_data` callbacks.

The split exists because a single-thread "read then process" loop lets a
slow consumer (large ring buffer eviction, many callbacks) delay the next
`port.read()` call, which is exactly what causes byte loss at high baud
rates: the OS-level UART driver buffer overflows while our thread is busy
elsewhere. Decoupling with an unbounded channel means the reader thread's
only job is draining the OS as fast as possible.

`RingBuffer` capacity bounds *retained* data (for display), not *incoming*
data — the channel between the two threads is unbounded, so ingestion can
never be blocked by the ring buffer being full.

## Consequences

- Every new transport (TCP/UDP client in Tháng 6, MQTT) must follow the same
  two-thread shape: an OS/socket-facing thread that never blocks on
  application logic, and a separate pump. `DataStream` doesn't enforce this
  in the type system, so it needs to stay documented and reviewed at PR time.
- `SerialStream::write` uses `&mut self` (a direct blocking write), which
  means one `SerialStream` instance can't be written to concurrently from
  multiple threads. Where a second concurrent writer is needed (see
  `examples/serial_loopback_benchmark.rs`) a second `SerialStream` handle to
  the same port name is opened instead of sharing one instance.
- `on_data` callbacks run on the pump thread, not the caller's thread — they
  must not block or panic, since that would stall the whole port's fan-out.
- Validated by `examples/pipeline_benchmark.rs` (synthetic, no hardware) and
  `examples/serial_loopback_benchmark.rs` (real hardware, TX/RX loopback) —
  see the G0-T4 benchmark log for current results.
