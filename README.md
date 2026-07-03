# EDT — Embedded DevTool

All-in-one desktop tool for embedded development: ESP32/STM32 flashing, serial monitor, and a realtime plotter — in one app instead of three or four.

> **Status:** MVP (Giai đoạn 1) implemented — serial monitor, ESP32 + STM32 flashing, and the realtime plotter are all working end to end. See [docs/quickstart.md](docs/quickstart.md) to build and try it. Beta release/polish is in progress; see [docs/ke-hoach-phat-trien-embedded-devtool.md](docs/ke-hoach-phat-trien-embedded-devtool.md) for the full roadmap and [docs/ke-hoach-chi-tiet-giai-doan-0-1.md](docs/ke-hoach-chi-tiet-giai-doan-0-1.md) for the detailed task breakdown.

## Why

Existing tools each cover one slice: PlatformIO (build/flash, weak monitor), CoolTerm/PuTTY (serial only), Hercules (TCP/UDP, unmaintained), STM32CubeProgrammer (STM32-only, no monitor). EDT aims to replace them for the common workflow, with a shared data pipeline so data flows into the same monitor and plotter regardless of source.

## What works today

- **Serial monitor:** multi-tab, virtualized rendering, hex/ASCII/mixed view, delta/absolute timestamps, auto-reconnect on unplug/replug, send panel (text/hex, configurable line ending, command history), log-to-file with rotation, DTR/RTS toggling, smart auto-scroll.
- **ESP32 flashing:** chip auto-detect (ESP32/S2/S3/C3/C6), MAC/flash-size read, multi-segment flash with progress, erase (full/region), flash read, reusable flash profiles.
- **STM32 flashing:** auto-detects an installed `STM32_Programmer_CLI`, flashes over ST-Link (SWD) or UART bootloader, mass erase, option-byte read/write with an RDP confirmation guard.
- **Realtime plotter:** up to 8 channels, auto-parses CSV/space-separated/`key:value`/Arduino-plotter-style lines, line/area/step/bar/point chart types, freeze/resume, zoom/pan, wired to any monitor tab as its data source.
- Dark/light/system theme, global keyboard shortcuts, persisted settings.

Not yet built: TCP/UDP/MQTT/WebSocket tools, Lua scripting engine, log filtering/data-extractor, FFT, plugin system — these are later-phase items in the roadmap docs above.

## Stack

- **Framework:** Tauri 2.x (Rust backend + React/TypeScript WebView frontend)
- **Serial:** `serialport-rs` · **ESP32 flash:** `espflash` (native Rust) · **STM32 flash:** wraps `STM32_Programmer_CLI`
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
