# EDT — Embedded DevTool

All-in-one desktop tool for embedded development: ESP32/STM32 flashing, serial monitor, and a realtime plotter — in one app instead of three or four.

> **Status:** Core MVP plus most of the post-MVP roadmap implemented — serial monitor, ESP32 + STM32 flashing, the realtime plotter, TCP/UDP/MQTT network tools, a Lua scripting engine, and RS485/Modbus RTU master-slave tooling are all working end to end. See [docs/quickstart.md](docs/quickstart.md) to build and try it. Beta release/polish is in progress; see [docs/ke-hoach-phat-trien-embedded-devtool.md](docs/ke-hoach-phat-trien-embedded-devtool.md) for the full roadmap and [docs/ke-hoach-chi-tiet-giai-doan-0-1.md](docs/ke-hoach-chi-tiet-giai-doan-0-1.md) for the detailed task breakdown.

## Why

Existing tools each cover one slice: PlatformIO (build/flash, weak monitor), CoolTerm/PuTTY (serial only), Hercules (TCP/UDP, unmaintained), STM32CubeProgrammer (STM32-only, no monitor). EDT aims to replace them for the common workflow, with a shared data pipeline so data flows into the same monitor and plotter regardless of source.

## What works today

- **Serial monitor:** multi-tab, virtualized rendering, hex/ASCII/mixed view, delta/absolute timestamps, auto-reconnect on unplug/replug, RS485 half-duplex (auto RTS toggle), automatic log-level coloring, regex filters (include/exclude) with full-text search and bookmarks, per-tab live stats (bytes/s, lines/s, errors, uptime), send panel (text/hex, configurable line ending, checksum/CRC append, command history), triggers (pattern match → send/sound/file-log/bookmark), macro recorder (record and replay with real timing), log-to-file with rotation, DTR/RTS toggling, smart auto-scroll.
- **Network tools:** TCP client/server and UDP (unicast/broadcast), plus an MQTT client — all driving the same monitor, filters, triggers, macros, and plotter as a serial connection, since every transport sits behind one shared data-stream abstraction.
- **RS485 / Modbus RTU:** a Modbus master (one-shot request builder plus repeating poll rules that feed the plotter) for testing RS485 sensors and devices, and a Modbus slave emulator with editable coil/register maps for testing a master device.
- **Lua scripting engine:** a sandboxed per-tab script with `on_data`/`send`/`send_hex`/`wait_for`/`log`/`alert`/`plot`/`timer`, for custom automation beyond filters/triggers.
- **Saved libraries:** connection profiles, a script library, and filter/trigger presets — save, load, or delete from any tab, stored locally.
- **ESP32 flashing:** chip auto-detect (ESP32/S2/S3/C3/C6), MAC/flash-size read, multi-segment flash with progress, erase (full/region), flash read, reusable flash profiles.
- **STM32 flashing:** auto-detects an installed `STM32_Programmer_CLI`, flashes over ST-Link (SWD) or UART bootloader, mass erase, option-byte read/write with an RDP confirmation guard.
- **Realtime plotter:** up to 8 channels, auto-parses CSV/space-separated/`key:value`/Arduino-plotter-style lines plus user-defined regex extractors, line/area/step/bar/point chart types, freeze/resume, zoom/pan, wired to any monitor tab, Lua script, or Modbus poll rule as its data source.
- Dark/light/system theme, global keyboard shortcuts, persisted settings, an in-app User Guide with worked examples for every feature.

Not yet built: WebSocket tooling, mDNS/DNS-SD device discovery, FFT, a plugin system — these are later-phase items in the roadmap docs above.

## Stack

- **Framework:** Tauri 2.x (Rust backend + React/TypeScript WebView frontend)
- **Serial:** `serialport-rs` · **ESP32 flash:** `espflash` (native Rust) · **STM32 flash:** wraps `STM32_Programmer_CLI`
- **MQTT:** `rumqttc` (synchronous client) · **Scripting:** `mlua` (sandboxed Lua 5.4) · **Modbus RTU:** hand-rolled TypeScript codec (CRC16 + frame encode/decode)
- **Plotter:** uPlot

See [docs/ke-hoach-phat-trien-embedded-devtool.md](docs/ke-hoach-phat-trien-embedded-devtool.md) §2 for the full architecture and rationale, and the [ADRs](docs/adr/) for the individual decisions.

## Getting started

See [docs/quickstart.md](docs/quickstart.md) for build/install instructions and a walkthrough of the monitor, flash, and plotter modules.

## Feedback

Found a bug or have a feature request? Use the in-app **Send feedback** button (Settings) or open an issue directly — see the [issue templates](.github/ISSUE_TEMPLATE/).

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

at your option.
