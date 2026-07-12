# Changelog

## v0.1.5 — 2026-07-12

- **SWD debug (new connection kind):** attaches to a debug probe
  (ST-Link/J-Link/CMSIS-DAP) via `probe-rs` instead of a serial port —
  streams RTT log output into a normal Monitor tab (needs `rtt-target`
  or SEGGER RTT in the firmware), and a Watch panel reads global/static
  variables live by name, resolved from a build's `.elf` DWARF info, no
  breakpoint needed.
- **STM32 Mass Production mode:** patches a unique serial number/MAC/key
  into each device's firmware before flashing and logs a CSV, plus a
  Production Stats panel totaling devices flashed across ESP32 batch and
  STM32 mass-production sessions.
- **Export/Import configuration:** every saved library (connection
  profiles, scripts, plugins, quick-command profiles, filter/trigger
  presets) bundled into one JSON file for backing a machine up or
  handing a teammate the same setup.
- **Security:** curated STM32 Readout Protection levels and ESP32 eFuse
  read/burn (flash encryption/secure boot/JTAG counters, pure Rust via
  `espflash` — no Python/`espefuse.py` needed), plus an app-wide flash
  PIN lock. Irreversible actions require typing a confirmation keyword.
- **Quick Commands:** a JSON editing mode (auto-indent, bracket
  auto-pairing, Tab inserts an indent instead of leaving the field)
  that compacts back to one line on save, plus a per-command line-ending
  override.
- STM32 flash panel's Security and raw option-bytes sections now
  collapse by default to cut the always-visible height.

## v0.1.4 — 2026-07-11

- **FTP client/server:** a plain-FTP client to browse, upload, download,
  create folders, and delete files on a device's SD-card/SPIFFS file
  server (or any FTP server), plus a local FTP server to share a folder
  on this machine with a device — its own panel, not a tab, since it's a
  file browser rather than a byte stream.
- **ESP32 OTA update over WiFi:** a fourth flash target that pushes
  firmware to a device over WiFi via the ArduinoOTA protocol — mDNS
  device discovery, MD5/PBKDF2-HMAC-SHA256 challenge auth depending on
  the device's Arduino core version, no USB cable required. A toast
  notification now reports success/failure for this (and batch flash,
  auto-flash-on-plug, and provisioning) regardless of which panel is
  open.
- **English/Vietnamese UI language**, switchable in Settings with no
  restart, covering every panel and the in-app User Guide.
- **ESP32 flashing convenience:** the port list now refreshes itself on
  USB plug/unplug (no manual Refresh), Batch mode gained an "auto-flash
  on plug" toggle for production runs, and a new Provision mode runs a
  scripted sequence of serial commands against an already-flashed device
  manually or automatically on plug. Smart add now parses the real
  ESP-IDF partition table and supplies its own bundled `boot_app0.bin`
  when one's needed, instead of guessing filesystem offsets.
- **Batch ESP32 flashing:** flash the same segments to multiple ports at
  once, with independent per-device progress and status.
- **`edt-cli`:** a new headless CLI binary
  (`edt-cli monitor --port COM3 --baud 115200`) for scripting/CI use,
  attached to each GitHub Release as a standalone per-platform download.
- **Project profiles (`.edtproj`):** save/restore the whole workspace —
  every tab's connection, filters/triggers/script, the Snap Layout
  arrangement, and the Plotter config — to a portable file.
- The plotter's buffer size is now configurable (default 10x the old
  hardcoded cap); the SSH terminal gained copy-on-select and fixed
  paste/auto-focus; sent data now echoes into the monitor as its own
  line so both directions of a conversation are visible.

## v0.1.3 — 2026-07-09

- Small update to support testing the auto-update flow and ensure the
  next release is visible to the updater.

## v0.1.2 — 2026-07-09

- **Renamed** the app to "Embedded DevTool" in the window title, taskbar,
  and installer (the underlying app identifier is unchanged, so this
  doesn't affect existing installs or auto-update continuity).
- **SSH terminal:** a new connection kind backed by a real interactive
  PTY, rendered with an actual terminal emulator instead of the
  line-oriented monitor — password auth only for now, and the host key
  isn't verified against a known-hosts list yet.
- **Multi-pane layout (Snap Layouts):** drag a tab to the edge of any
  pane to split the workspace and view tabs side by side, nestable and
  resizable; drag a tab onto another pane's tab strip or the middle of
  its content to merge panes back together. The Plotter stays shared
  across the whole window rather than living in one pane.
- **Quick Commands:** a compact, always-visible row of one-click,
  frequently-reused commands (text or hex) above the send box, grouped
  into named profiles you can switch per tab; drag a chip to reorder its
  priority.
- Fixed the "New connection" panel covering the top bar and blocking
  clicks on its icon buttons (Settings, Network Scanner, ...), most
  noticeable on first launch.
- Fixed drag-and-drop not working on Windows — Tauri's OS-level
  drag-drop capture was silently blocking the browser's native
  drag-and-drop that pane-splitting and quick-command reordering rely
  on.

## v0.1.1 — 2026-07-06

No app-facing changes — this bump exists only to move past v0.1.0, whose
tag/draft release ended up entangled with testing the release tooling
itself. Release process changes only:

- `scripts/release.ps1` now builds a local installer and prints its
  resolved path, fixes a bug where it silently wrote a UTF-8 BOM into
  `package.json`/`tauri.conf.json` (broke `cargo`'s JSON parser), and
  gained `-Publish` (create the GitHub Release directly via the `gh`
  CLI, for when the CI-based signed release isn't set up yet).
- Confirmed the CI release workflow (`-Push`) can't succeed until
  `TAURI_SIGNING_PRIVATE_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are
  actually added as repo secrets — it's been failing silently on every
  attempt so far.

## v0.1.0 — 2026-07-06

First tagged release. EDT bundles serial monitoring, ESP32/STM32 flashing,
network tooling, and a realtime plotter into one app.

- **Serial monitor:** multi-tab virtualized log view (hex/ASCII/mixed),
  delta/absolute timestamps, auto-reconnect on unplug/replug, RS485
  half-duplex (auto RTS toggle), automatic log-level coloring, regex
  include/exclude filters with full-text search and bookmarks, per-tab live
  stats (bytes/s, lines/s, errors, uptime), a send panel (text/hex,
  configurable line ending, checksum/CRC append, command history),
  triggers (pattern match → send/sound/file-log/bookmark), a macro
  recorder (record and replay with real timing), log-to-file with
  rotation, and DTR/RTS toggling.
- **Network tools, each with a protocol-appropriate view instead of a
  generic byte stream:**
  - **MQTT:** a topic tree explorer with per-topic message history,
    JSON-aware payload rendering (auto pretty-print, syntax highlighting,
    hex fallback for binary), dynamic subscribe/unsubscribe, publish
    presets, and a connect that verifies the broker's CONNACK before
    handing you the terminal instead of reporting success against a
    socket that might still be silently retrying.
  - **UDP:** a packet log showing each datagram's sender address, size,
    and payload — previously flattened into one anonymous byte stream.
  - **WebSocket:** a frame log distinguishing Text and Binary frames (and
    the ability to actually send a Text frame, not just Binary).
  - **TCP client/server** and a **Network Scanner** (CIDR + common-port
    sweep, ARP/reverse-DNS host info, per-host deep scan) for finding LAN
    devices that don't advertise themselves via mDNS.
  - Connection profiles, last-used config, and mDNS "Scan LAN" presets are
    now scoped per protocol instead of one shared list/default.
- **RS485 / Modbus:** a Modbus RTU master (one-shot requests plus
  repeating poll rules feeding the plotter) and slave emulator
  (editable coil/register maps, spec-correct exception responses), plus
  Modbus TCP support over any TCP client tab via an MBAP adapter on the
  same RTU codec.
- **Lua scripting engine:** a sandboxed per-tab script
  (`on_data`/`send`/`send_hex`/`wait_for`/`log`/`alert`/`plot`/`timer`)
  with syntax highlighting, for automation beyond filters/triggers.
- **Saved libraries:** connection profiles, a script library, and
  filter/trigger presets — save, load, or delete from any tab.
- **ESP32 flashing:** chip auto-detect (ESP32/S2/S3/C3/C6), MAC/flash-size
  read, multi-segment flash with progress, erase (full/region), flash
  read, and reusable flash profiles.
- **STM32 flashing:** auto-detects an installed `STM32_Programmer_CLI`,
  flashes over ST-Link (SWD) or UART bootloader, mass erase, and
  option-byte read/write with an RDP confirmation guard.
- **Realtime plotter:** up to 8 channels, auto-parsing of
  CSV/space-separated/`key:value`/Arduino-plotter-style lines plus
  user-defined regex extractors, line/area/step/bar/point chart types,
  freeze/resume, zoom/pan, an FFT spectrum view (Hann/Hamming/rectangular
  windows), computed math channels (A±B, A×B, A÷B, moving average,
  derivative, RMS), threshold lines with edge-triggered beep alerts, a
  live min/max/avg/peak-to-peak/frequency stats strip, and CSV/PNG
  export — wired to any monitor tab, Lua script, or Modbus poll rule as
  its data source.
- **Auto-update:** checks GitHub Releases for a newer version from
  Settings, downloads, and relaunches; releases are built and signed via
  a GitHub Actions workflow triggered by pushing a version tag.
- Dark/light/system theme, global keyboard shortcuts, persisted settings,
  and an in-app User Guide with worked examples for every feature.
