# EDT — Embedded DevTool

All-in-one desktop tool for embedded development: ESP32/STM32 flashing, serial monitor, realtime plotter, and TCP/UDP/MQTT networking — in one app instead of five.

> **Status:** early planning / pre-code. See [docs/ke-hoach-phat-trien-embedded-devtool.md](docs/ke-hoach-phat-trien-embedded-devtool.md) for the full roadmap and [docs/ke-hoach-chi-tiet-giai-doan-0-1.md](docs/ke-hoach-chi-tiet-giai-doan-0-1.md) for the detailed task breakdown of the current phase (setup → MVP beta).

## Why

Existing tools each cover one slice: PlatformIO (build/flash, weak monitor), CoolTerm/PuTTY (serial only), Hercules (TCP/UDP, unmaintained), STM32CubeProgrammer (STM32-only, no monitor). EDT aims to replace all of them for the common workflow, with a scripting engine (Lua) and a shared data pipeline so serial/TCP/UDP/MQTT data all flow into the same monitor and plotter.

## Planned stack

- **Framework:** Tauri 2.x (Rust backend + WebView frontend)
- **Serial:** `serialport-rs` · **ESP32 flash:** `espflash` · **STM32 flash:** wraps `STM32_Programmer_CLI` · **MQTT:** `rumqttc`
- **Scripting:** Lua via `mlua`
- **Plotter:** uPlot / WebGL

See [docs/ke-hoach-phat-trien-embedded-devtool.md](docs/ke-hoach-phat-trien-embedded-devtool.md) §2 for the full architecture and rationale.

## Repository status

No code yet — this repo currently holds planning docs. First implementation milestone is the Phase 0 proof-of-concept (Tauri + serialport-rs, 2 Mbps throughput benchmark); see the detailed task list linked above.

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

at your option.
