# ADR-003: Internal pub/sub event bus

- Status: Accepted
- Date: 2026-07-03

## Context

Main plan §2.2.1 mandates that modules never call each other directly, so new
modules (TCP/UDP, MQTT, script engine, trigger/action) can be added later
without editing existing ones. This needs a concrete mechanism.

## Decision

A hand-rolled synchronous broadcast bus (`src-tauri/src/core/event_bus.rs`):
`EventBus::subscribe()` hands out a `crossbeam_channel::Receiver<Event>`;
`EventBus::publish(event)` clones the event to every live subscriber and
prunes subscribers whose receiver has been dropped.

Rejected alternatives:
- `tokio::sync::broadcast` — pulls the whole bus onto the async runtime, but
  the highest-throughput producer (`SerialStream`'s reader thread, ADR-004)
  is a plain OS thread by design (blocking `read()` on the port, not
  `async`). Bridging a sync thread into a tokio broadcast channel adds a
  runtime-handle dependency for no benefit at this stage.
- A single `crossbeam_channel` receiver shared by all consumers — rejected
  because crossbeam channels are MPMC with *competing* consumers (one
  message goes to one receiver), not broadcast; monitor, plotter, and
  logger all need to see the same `DataReceived` event independently.

`Event::DataReceived` carries `Arc<[u8]>` so publishing a large batch to N
subscribers is N pointer clones, not N data copies.

## Consequences

- Any module that needs to react to stream lifecycle or data must subscribe
  to the bus rather than being handed a reference to the producer.
- `publish()` is synchronous and O(subscribers) — fine at the event
  granularity used here (batched per ~16ms per §2.2.3), not per-byte or
  per-line. A module must not do expensive work inline in response to an
  event on the calling thread; if that turns out to be needed, hand the
  event to a worker thread/queue rather than block `publish()`'s caller.
- If a future module needs cross-process or persisted events (e.g. the
  Giai đoạn 3 REST API), that is a different concern layered on top of this
  bus, not a replacement for it.
