# Changelog

## v0.1.10 — 2026-07-21

- **FTP now works as a tab, the same way SSH's SFTP sidebar does.** Connect
  to an FTP server from the main Connect screen (new "FTP" option) to get a
  file-tree sidebar and a built-in code editor — browse, upload
  (drag-and-drop or picked from disk), rename, and delete files, and open
  several at once with syntax highlighting, dirty-change tracking, and
  Ctrl+S to save, splittable into two side-by-side editor groups just like
  SSH's. Multiple FTP tabs can be open at the same time now, each its own
  connection. Uploads/downloads show a live progress percentage. The old
  FTP window (topbar button) is now server-only — hosting a local FTP
  server for a device to read/write files on this computer — since
  browsing a remote server has moved to the tab.
- **Fix: FTP folder tree showing the same handful of entries endlessly
  repeated, however deep you expanded.** Some embedded FTP servers (common
  on ESP32 boards) silently ignore the path argument on `LIST` and always
  return the root folder's contents — every subfolder now gets a real
  directory change before listing instead of trusting that argument.
- **Fix: FTP directory listing coming back completely empty against some
  ESP32 FTP servers.** Certain minimal server implementations format
  listings with tabs instead of spaces and only one owner column instead of
  the user+group pair a standard Unix listing has — both are now handled.
- **Fix: connecting could hang forever with no way to back out.** TCP
  client connections, the SSH file-browser's own connection, FTP, and SWD
  debug-probe attach could all wait indefinitely against an unresponsive
  target with no timeout at all; every one of them now gives up and reports
  an error after a bounded wait. The Connect screen also gained an actual
  Cancel button while a connection attempt is in progress, so a slow/stuck
  attempt no longer has to be waited out to try again.
- **The local FTP server can now be used as a real LAN file-transfer
  service:** starting it shows the address (`ftp://<lan-ip>:<port>`) other
  devices on the network should connect to, with a one-click copy button,
  plus a hint to check the firewall if nothing can reach it.
- **Code editor upgrades** (SSH's SFTP editor and the new FTP editor both):
  line numbers, find-in-file (Ctrl+F) with every match highlighted and the
  selected one visibly distinct from the rest, a word-wrap toggle, a
  line/column readout, a "Save All" button for multiple dirty files at
  once, a warning if the connection drops while there are unsaved changes,
  and a richer, more distinct syntax color palette (comments, strings,
  numbers, keywords, properties, and functions each get their own color
  instead of several sharing one). Also added highlighting support for
  TOML, XML/HTML, CSS, JavaScript, TypeScript, Rust, and C++.
- **Monitor:** a button next to "Log to file" now opens the log folder
  directly in the file explorer instead of having to go find it manually.
- **Network scan now finds every device on the LAN**, not just ones with a
  port open from the common-ports list — a device that responded to the
  scan's connection attempts but has none of those ports open used to be
  silently dropped from the results.

## v0.1.9 — 2026-07-18

- **SSH workspace:** an SSH tab is no longer just a terminal — a new
  collapsible SFTP file-tree sidebar lets you browse, upload (including
  drag-and-drop), rename, and delete remote files over the same
  connection, without a separate FTP server. Double-click a file to edit
  it in a built-in code editor (syntax highlighting, dirty-change
  indicator, Ctrl+S to save) — multiple files can be open at once, and can
  be split into two side-by-side editor groups (drag a tab to the other
  group or its right edge, VSCode-style). The terminal itself moves to a
  collapsible, resizable bottom dock and now supports multiple
  simultaneous terminals, also splittable into two side-by-side groups.
  Existing SSH tabs are unaffected until you opt in — the sidebar starts
  closed and only one terminal runs unless you add more.
- **Fix: serial port lock contention that could still stall the app with
  multiple devices connected.** Following up on v0.1.8's fix, every
  `PortManager` operation — including the 16ms tick that feeds live data to
  every open tab, and per-port logging's disk writes — shared one lock
  across all ports. Each port now has its own lock, so a slow or flaky
  device can no longer block any other port's data, by construction.
- **Fix: Send panel history.** Repeating the same command no longer
  clutters Up-arrow recall with duplicate entries (re-sending a command
  moves it to the top instead of adding a copy), and pressing Down-arrow
  past the bottom no longer left Up-arrow looking unresponsive.
- **Fix: one stalled network connection can no longer freeze every
  network tab.** Opening a connection to an unresponsive host (an MQTT
  broker that never answers, a slow SSH server, a TCP host that doesn't
  respond) used to hold a shared lock that also feeds live data to every
  open network tab, silencing all of them until the connect timed out.
  Network streams now use the same per-stream locking serial ports got in
  v0.1.8/v0.1.9. Writing to a WebSocket could also stall behind the
  connection's own idle polling — sends now always get through, and
  writing to a TCP peer that stopped reading errors out after 5 seconds
  instead of hanging the tab forever.
- **Fix: a busy serial port no longer delays other ports' live data**
  (e.g. an RS485 write waiting out its direction-guard time on the same
  tick).
- **Fix: large SFTP/FTP transfers no longer block other file
  operations.** Reading or writing a big remote file made every other
  SFTP/FTP command (even on other sessions) wait for the whole transfer.
- Updated the app icon, and fixed the Linux/macOS installer builds that
  the first v0.1.9 release attempt failed on — the exported icon set was
  slightly non-square and one file was misreferenced, which the
  Linux/macOS bundlers reject (Windows only reads the .ico and kept
  building).

## v0.1.8 — 2026-07-15

- **Fix: tool freezing with multiple serial devices connected.** Opening a
  port, and the background auto-reconnect check, each ran their slowest
  work (OS port enumeration, the actual driver open call) while holding
  the same lock the live-data feed for every other open tab depends on.
  With several devices open at once — or one flaky device on a shared USB
  hub — this could stall or fully freeze the whole app. Both paths now do
  their slow work without holding that lock.

## v0.1.7 — 2026-07-15

- **UI scale:** a new Settings slider (80–150%) resizes the whole
  interface — text, icons, spacing — for users who find the default too
  small, separate from the existing log-only font size preset.
- **Live dashboard:** auto-discovers `key=value`/`key: value`/JSON
  telemetry fields in a tab's stream and shows the latest value of each
  as a live widget grid.
- **Data inspector:** right-click a byte selection in the monitor to
  decode it as int/uint (8/16/32/64-bit), float, ASCII, and binary, in
  either endianness.
- **Frame builder:** compose a binary frame (hex/text/integer fields plus
  an auto-computed length and CRC) from a new monitor toolbar flyout and
  send it.
- **ANSI colors:** color codes in a device's own log output (ESP-IDF/
  Zephyr-style) are rendered instead of stripped.
- **Format JSON/CSV:** right-click a monitor selection to pretty-print
  JSON or column-align CSV/TSV in a popup.
- **Compare logs:** a side-by-side diff of two logs (pasted, or loaded
  from an open tab) with added/removed lines highlighted.
- **Broadcast send:** send one command to several open connections at
  once, from the command palette.
- **Periodic/heartbeat send:** repeat a command on an interval from the
  Send panel, no script needed.
- **Export diagnostics bundle:** a redacted JSON snapshot (version,
  settings, recent per-tab logs — passwords/tokens/PINs stripped) for bug
  reports.
- **ESP32 core dump decoder:** paste a UART core dump to resolve
  candidate addresses against the build's `.elf`, alongside the existing
  crash decoder.
- **STM32:** a new "Write memory" tool pokes text/hex/decimal/JSON
  content to any address; selecting a `.hex` file auto-fills the flash
  address from its own records; `STM32_Programmer_CLI` no longer flashes
  a console window; every flash file-path field (ESP32/STM32/OTA/Debug/
  FTP/trigger) now accepts a typed/pasted path, not just Browse; the
  Flash panel remembers its last tab/mode across close and reopen.
- **Personalization:** a custom accent color (Settings), per-tab
  color/emoji labels (tab right-click menu), and a first-run onboarding
  screen.
- **`?` shortcut cheat-sheet**, backed by the same list Settings shows —
  which also fixes that list having been missing `Ctrl+Shift+G` since it
  was added in v0.1.6.
- Fixed the Triggers panel's Send/Write-to-file row clipping in narrow
  panes.

## v0.1.6 — 2026-07-14

- **SSH:** the terminal no longer loses its scrollback when you switch to
  another tab and back; a reconnect UI (with an opt-in "remember password"
  backed by the OS credential store — Windows Credential Manager / macOS
  Keychain / Linux Secret Service) lets a dropped or wrong-password
  connection be retried right there instead of closing and re-adding the tab.
- **Cross-tab search (`Ctrl+Shift+G`):** searches every open tab's buffer
  at once and jumps straight to a match, instead of one tab at a time.
- **Crash decoder:** a resolved backtrace frame's file:line is now
  clickable, opening it directly in VS Code.
- **Plugins:** install a decoder/plotter-parser plugin from a URL, not
  just a local `.lua` file.
- **`edt-cli test`:** an optional `webhookUrl` posts a pass/fail summary
  to a Slack or Discord webhook once a suite finishes.
- **Recent Connections** moved from an always-visible list inside the
  connect panel to a topbar dropdown — picking an entry reconnects
  immediately instead of just prefilling the form.
- Fixed `Ctrl+Shift+F` also popping open the monitor's in-tab search
  bar in addition to toggling the Flash panel.

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
