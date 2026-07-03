# Quickstart

> Covers building EDT from source and using the serial monitor, ESP32/STM32 flash tools, and the plotter. For the product roadmap see [ke-hoach-phat-trien-embedded-devtool.md](ke-hoach-phat-trien-embedded-devtool.md); for the task-level plan see [ke-hoach-chi-tiet-giai-doan-0-1.md](ke-hoach-chi-tiet-giai-doan-0-1.md).

## Install

No signed installer is published yet — build from source:

**Prerequisites**
- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) 22+
- Tauri's platform dependencies — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for your OS (on Linux this means `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, `libxdo-dev`)
- To flash STM32 boards: [STM32CubeProgrammer](https://www.st.com/en/development-tools/stm32cubeprog.html) installed (EDT wraps its bundled CLI — it cannot be redistributed, see [ADR context](adr/)); ESP32 flashing has no external dependency (`espflash` is a native Rust library).

**Build & run**

```bash
git clone https://github.com/thanhsyo2508/embedded-devtool.git
cd embedded-devtool
npm install
npm run tauri dev     # dev mode with hot reload
# or
npm run tauri build    # produces an installer/bundle under src-tauri/target/release/bundle/
```

CI (`.github/workflows/ci.yml`) builds installers for Windows, Linux, and macOS on every push to `main` — grab one from the Actions run's artifacts if you'd rather not build locally.

## Serial monitor

1. Click **+** in the tab strip (or `Ctrl+N`) to open the connection panel.
2. Pick a port, baud rate, and framing (data bits/parity/stop bits/flow control). Leave **Auto-reconnect** on to have the tab reopen automatically if the device is unplugged and replugged.
3. Click **Connect**. Each connection is its own tab — open as many as you have ports.
4. In the monitor toolbar: toggle **mixed / hex / ascii** view, and **delta / abs / off** timestamps.
5. **Send panel** below the log: type text or switch to `hex` mode (e.g. `01 02 FF`), pick the line ending (None/CR/LF/CRLF), press Enter or click Send. Arrow up/down recalls previous sends.
6. Click the disk icon to start logging this tab's data to file (raw + timestamped, rotated at 50 MB); click again to stop.
7. `Space` pauses/resumes the view without losing incoming data; scrolling up disables auto-scroll and a "jump to bottom" button appears.

## Flash ESP32

1. Open the flash panel (`Ctrl+Shift+F`), keep the **ESP32** tab selected.
2. Pick the port and baud rate, then **Detect chip** to confirm the variant (ESP32/S2/S3/C3/C6), MAC address, and flash size.
3. Add one or more segments (offset + `.bin` file) with **Add segment** / the folder icon.
4. **Flash** — progress streams live; **Erase chip** wipes the whole flash first if needed.
5. **Save profile** / **Load profile** persists the segment list + baud rate as JSON so a repeat flash is one click.

## Flash STM32

1. Open the flash panel, switch to the **STM32** tab. EDT auto-detects an installed `STM32_Programmer_CLI`; if it can't find one it prompts you to install CubeProgrammer.
2. Choose the interface: **ST-Link (SWD)** for boards with an on-board/external ST-Link, or **UART bootloader** (put the MCU in bootloader mode via BOOT0 first) for boards without one.
3. Pick the `.bin`/`.hex` file and target address, then **Flash** — CLI output streams live so you can see exactly what the programmer is doing.
4. **Mass erase** wipes the chip. Option-byte writes (e.g. RDP level) require an explicit confirmation dialog since they can permanently affect debug access — read it before confirming.

## Plotter

1. Toggle the plotter dock with the chart icon in the top bar or `Ctrl+Shift+P`.
2. Pick a monitor tab as the **source** — the plotter reads whatever that tab is already receiving, no separate connection needed.
3. Lines are auto-parsed as CSV (`1.2,3.4`), space-separated, `key:value`/`key=value`, or plain numbers (assigned `ch1`, `ch2`, …) — up to 8 channels.
4. Drag to zoom on the x-axis, **Reset zoom** to return to the full range, **Freeze** to stop the view while data keeps accumulating underneath (no data lost on resume).
5. Toggle individual channels via the legend chips under the toolbar; switch chart type (line/area/step/bars/points) from the dropdown.

## Keyboard shortcuts

See the full list in **Settings** (`Ctrl+,`), or [`SettingsPanel.tsx`](../src/components/SettingsPanel.tsx).
