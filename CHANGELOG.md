# Changelog

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
