# ADR-001: Desktop framework = Tauri 2.x, core = Rust

- Status: Accepted
- Date: 2026-07-03

## Context

The app needs to talk to serial ports, TCP/UDP/MQTT sockets, and subprocess flashing
tools (espflash, STM32_Programmer_CLI) at high throughput (target: 2 Mbps serial with
zero drop, see [ke-hoach-phat-trien-embedded-devtool.md](../ke-hoach-phat-trien-embedded-devtool.md)
§2.2/§3), while rendering a complex desktop UI (multi-tab monitor, realtime plotter,
drag-drop panels). Candidates considered: Electron + Node backend, Tauri + Rust backend,
a native toolkit (Qt/GTK) directly.

## Decision

Use **Tauri 2.x** for the desktop shell and **Rust** for all I/O-heavy core logic
(serial, network, ring buffers, flashing, scripting host). The frontend is a WebView
client of the Rust core — never does I/O directly.

Reasons:
- Electron's Node backend has GC pauses and weaker low-level serial/USB ergonomics;
  Rust gives predictable latency for the ring-buffer/batch-IPC design already
  committed to in the plan.
- Tauri installers are far smaller (~10MB vs Electron's ~150MB) — matters for the
  "install and flash in 5 minutes" Beta DoD.
- `serialport-rs`, `espflash`, and `rumqttc` are native Rust crates — no FFI/bridge
  layer needed.
- A native toolkit (Qt/GTK) would give up the WebView's UI velocity (multi-tab,
  virtualized lists, drag-drop layout) for marginal performance gain the Rust-core +
  batched-IPC design already achieves.

## Consequences

- All IPC between frontend and core must go through Tauri's command/event system;
  this is why the plan mandates batched (60fps) events instead of per-line IPC calls
  (see ADR-003, event bus design).
- Every module (flash manager, script engine, network clients) lives in the Rust
  core and is exposed via Tauri commands — reinforces principle "mọi thao tác đều có
  API" (§2.2.4 of the main plan), which is what makes the later CLI mode (Giai đoạn 3)
  possible without rewriting core logic.
- Team needs Rust proficiency; onboarding cost is higher than a pure-JS stack.
