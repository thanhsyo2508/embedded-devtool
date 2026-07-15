# EDT — Embedded DevTool

All-in-one desktop tool for embedded development: ESP32/STM32 flashing, serial monitor, and a realtime plotter — in one app instead of three or four.

> **Status:** v0.1.7 — the full roadmap's core feature set is implemented and working end to end: serial monitor, SSH terminal, ESP32 + STM32 flashing (including WiFi OTA and batch/provisioning modes), an FTP client/server, the realtime plotter (with FFT and math channels), TCP/UDP/WebSocket/MQTT/SSH network tools (each with a protocol-appropriate terminal, not a generic byte stream), a LAN network scanner, RS485/Modbus RTU + Modbus TCP, a Lua scripting engine plus an installable Lua plugin system (custom decoders/plotter parsers), a live telemetry dashboard, a binary frame builder, a byte-level data inspector, an ESP32 crash/core-dump decoder and ELF memory-map analyzer, an optional local REST API for CI/production-line integration, a headless CLI test runner (YAML suites, JUnit/HTML reports), a command palette (Ctrl+K), a VS Code-style multi-pane split layout, English/Vietnamese UI language, and auto-update via GitHub Releases. See [docs/quickstart.md](docs/quickstart.md) to build and try it, and [CHANGELOG.md](CHANGELOG.md) for what shipped in this release. See [docs/ke-hoach-phat-trien-embedded-devtool.md](docs/ke-hoach-phat-trien-embedded-devtool.md) for the full roadmap and [docs/ke-hoach-chi-tiet-giai-doan-0-1.md](docs/ke-hoach-chi-tiet-giai-doan-0-1.md) for the detailed task breakdown.

## Why

Existing tools each cover one slice: PlatformIO (build/flash, weak monitor), CoolTerm/PuTTY (serial only), Hercules (TCP/UDP, unmaintained), STM32CubeProgrammer (STM32-only, no monitor). EDT aims to replace them for the common workflow, with a shared data pipeline so data flows into the same monitor and plotter regardless of source.

## What works today

- **Serial monitor:** multi-tab, virtualized rendering, hex/ASCII/mixed view, delta/absolute timestamps, auto-reconnect on unplug/replug, RS485 half-duplex (auto RTS toggle), automatic log-level coloring plus rendered ANSI color codes (ESP-IDF/Zephyr-style), regex filters (include/exclude) with full-text search across the current tab or every open tab at once, and bookmarks, per-tab live stats (bytes/s, lines/s, errors, uptime), send panel (text/hex, configurable line ending, checksum/CRC append, command history, a repeat-on-interval toggle for heartbeats/polling), quick commands (one-click, drag-to-reorder, saved profiles), triggers (pattern match → send/sound/file-log/bookmark), macro recorder (record and replay with real timing), log-to-file with rotation, DTR/RTS toggling, smart auto-scroll. A right-click on any selection can also decode it byte-by-byte (int/uint 8–64-bit, float, ASCII, binary, either endianness) or pretty-print it as JSON/aligned CSV. A **live dashboard** auto-discovers `key=value`/`key: value`/JSON telemetry fields in the stream and shows the latest value of each as a widget grid; a **frame builder** composes a binary frame (hex/text/integer fields plus an auto-computed length and CRC) and sends it; a **broadcast send** (command palette) fires one command at several open connections at once; a **log compare** (command palette) diffs two logs side by side.
- **Network tools**, each with a protocol-appropriate terminal instead of one generic byte stream:
  - **MQTT** — a topic tree explorer with per-topic message history, JSON-aware payload rendering (auto pretty-print, syntax highlighting, hex fallback for binary), dynamic subscribe/unsubscribe, publish presets, and a connect that waits for the broker's CONNACK before handing you the terminal.
  - **UDP** — a packet log showing each datagram's sender address, size, and payload.
  - **WebSocket** — a frame log distinguishing Text and Binary frames, with the ability to send either.
  - **SSH** — a real interactive terminal (PTY over `russh`, rendered with xterm.js) for password-authenticated shell access.
  - **TCP client/server**, plus a standalone **Network Scanner** (CIDR + common-port sweep, ARP/reverse-DNS host info, per-host deep scan) for finding LAN devices that don't advertise via mDNS.
  - Every transport still drives the same filters, triggers, macros, and plotter as a serial connection, since they all sit behind one shared data-stream abstraction; connection profiles, last-used config, and mDNS "Scan LAN" presets are scoped per protocol.
- **FTP client/server:** a plain-FTP (RFC 959) client — connect, browse, upload, download, create folders, delete — for talking to a device's SD-card/SPIFFS file server, plus a local FTP server to share a folder on this machine with a device, with optional username/password (anonymous by default). A file browser rather than a byte stream, so it's its own panel instead of a tab.
- **Multi-pane layout (Snap Layouts):** drag a tab to the edge of any pane to split the workspace and view tabs side by side, nestable and resizable like a code editor; drag a tab onto another pane to merge it back.
- **RS485 / Modbus:** a Modbus RTU master (one-shot request builder plus repeating poll rules that feed the plotter) for testing RS485 sensors and devices, a Modbus slave emulator with editable coil/register maps for testing a master device, and Modbus TCP support over any TCP client tab.
- **Lua scripting engine:** a sandboxed per-tab script with `on_data`/`send`/`send_hex`/`wait_for`/`log`/`alert`/`plot`/`timer`, for custom automation beyond filters/triggers.
- **Plugins:** named, reusable Lua files (install once from the Plugins button, then enable per tab) — a **decoder** plugin defines `decode(line)` and shows the returned fields live in that tab's Plugins panel; a **plotter parser** plugin defines `parse(line)` and feeds the returned channels straight into the plotter. Unlike a script, a plugin is a single pure function (no `send`/`wait_for`/`timer`) and several can run on the same tab at once; the manifest (name/version/kind/description) is just leading `-- key: value` comment lines, so installing one is picking a single `.lua` file.
- **Saved libraries:** connection profiles, a script library, quick-command profiles, and filter/trigger presets — save, load, or delete from any tab, stored locally.
- **Project profiles (`.edtproj`):** save/restore the whole workspace to a file — every open tab's connection, filters/triggers/script, the Snap Layout arrangement, and the Plotter's config — portable between machines instead of tucked away in local app storage.
- **ESP32 flashing:** chip auto-detect (ESP32/S2/S3/C3/C6), MAC/flash-size read, multi-segment flash with progress, erase (full/region), flash read, reusable flash profiles, and a batch mode that flashes the same segments to multiple ports concurrently with independent per-device progress/status. **Smart add** picks your build output files (bootloader/partitions/firmware/filesystem image) and fills in each one's offset automatically — parsing the actual compiled partition table when one's included rather than guessing, since a filesystem image's offset shifts with flash size/partition scheme; supplies its own bundled `boot_app0.bin` (LGPL-2.1, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) when an OTA partition table needs one and you didn't provide your own. The port list refreshes itself on USB plug/unplug (no manual Refresh needed), and Batch mode has an "auto-flash on plug" toggle for production runs — a newly plugged ESP32-like device flashes immediately with the current profile, no per-device confirmation. A third **Provision** mode runs a scripted sequence of plain serial commands (with wait-for-response/timeout or fixed delays per step) against an already-flashed device — manually on demand or automatically on plug — for commissioning boards with device-specific config over their own command line, independent of flashing. A fourth top-level **OTA (WiFi)** target flashes over WiFi via the ArduinoOTA protocol (mDNS device discovery, MD5/PBKDF2-HMAC-SHA256 challenge auth depending on the device's Arduino core version) — no USB cable, for devices already running `ArduinoOTA.h`. A fifth **Debug** target reads a build's `.elf` directly (DWARF debug info + section headers, pure Rust — no bundled toolchain binary needed) for a flash/RAM usage breakdown by section, a crash decoder that resolves a pasted backtrace's raw addresses (`Backtrace: 0x...:0x...`) into function names and file:line (click one to open it in VS Code), and a core dump decoder that resolves candidate addresses out of a pasted UART core dump the same way.
- **STM32 flashing:** auto-detects an installed `STM32_Programmer_CLI` and runs it without flashing a console window, flashes over ST-Link (SWD) or UART bootloader, mass erase, option-byte read/write with an RDP confirmation guard, a **write memory** tool that pokes arbitrary text/hex/decimal/JSON content to any address, and auto-fills the flash address from a selected `.hex` file's own records (a `.bin` still needs it typed in, since it carries no address information).
- **Realtime plotter:** up to 8 channels, auto-parses CSV/space-separated/`key:value`/Arduino-plotter-style lines plus user-defined regex extractors, line/area/step/bar/point chart types, freeze/resume, zoom/pan, an FFT spectrum view (Hann/Hamming/rectangular windows), computed math channels (A±B, A×B, A÷B, moving average, derivative, RMS), threshold lines with edge-triggered beep alerts, a live min/max/avg/peak-to-peak/frequency stats strip, CSV/PNG export, wired to any monitor tab, Lua script, or Modbus poll rule as its data source.
- **Auto-update:** checks GitHub Releases for a newer version from Settings, downloads, and relaunches — releases are built and signed via a GitHub Actions workflow triggered by a version tag.
- **Headless CLI (`edt-cli`):** a separate binary for scripting/CI use — `monitor` streams a serial port's raw output to stdout, `test` runs a YAML test suite (flash → send → expect steps) against a real device with JUnit XML/HTML reports and a CI-friendly exit code. Not bundled with the GUI installer; see **[docs/cli.md](docs/cli.md)** for the full command reference, YAML schema, and a CI usage example.
- **Local REST API:** off by default (enable it in Settings) — lets an external CI/production-line system open a serial port, write/read bytes, list ports, and trigger an ESP32 flash on an already-running EDT instance over plain HTTP. Binds to `127.0.0.1` only and every request needs a bearer token (shown in Settings, regenerable).
- **Command palette (`Ctrl+K`):** type to find and run any top-level action — new connection, open/save project, toggle the plotter, Flash/FTP/Plugins/Settings, close/clear the focused tab — instead of hunting for its icon; doubles as a live, always-accurate keyboard-shortcut reference.
- Dark/light/system theme with a customizable accent color, a UI scale slider (80–150%, resizes the whole interface — text, icons, spacing — not just the log font) for anyone who finds the defaults too small, global keyboard shortcuts with a `?` cheat-sheet overlay, per-tab color/emoji labels, a first-run onboarding screen, persisted settings, an in-app User Guide with worked examples for every feature, English/Vietnamese UI language (switchable in Settings, no restart needed). A toast notification reports success/failure for batch flash, auto-flash-on-plug, provisioning, OTA, and FTP transfers regardless of which panel or tab is currently open — a notification-bell dropdown in the top bar keeps the last 50 so a missed one isn't gone for good. A topbar dropdown remembers your last few connections (across every protocol) for one-click reconnect, on top of named saved profiles. An **export diagnostics bundle** action (command palette) writes a redacted JSON snapshot — app version, settings, and each tab's recent log, with passwords/tokens/PINs stripped — for attaching to a bug report.

Not yet built: WASM plugins (current plugins are Lua-only) and custom panels contributed by a plugin — see the roadmap docs above for later-phase items.

## Stack

- **Framework:** Tauri 2.x (Rust backend + React/TypeScript WebView frontend)
- **Serial:** `serialport-rs` · **ESP32 flash:** `espflash` (native Rust) · **STM32 flash:** wraps `STM32_Programmer_CLI`
- **MQTT:** `rumqttc` (synchronous client) · **WebSocket:** `tungstenite` · **mDNS discovery:** `mdns-sd`
- **FTP client:** `suppaftp` (blocking) · **FTP server:** `libunftp` + `unftp-sbe-fs` (async, own `tokio` runtime)
- **Local REST API:** `tiny_http` (blocking, thread-per-request)
- **ELF/DWARF (memory map, crash decoder):** `object` + `addr2line` (pure Rust) · **CLI test suites:** `serde_yaml`
- **Scripting:** `mlua` (sandboxed Lua 5.4) · **Modbus RTU/TCP:** hand-rolled TypeScript codec (CRC16 + frame encode/decode)
- **Plotter:** uPlot · **Auto-update:** `tauri-plugin-updater` + GitHub Releases

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

One bundled third-party binary asset (`boot_app0.bin`, used by ESP32 flashing)
ships under a different license — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
