import { BookOpenIcon, XIcon } from './icons'

const SCRIPT_EXAMPLE = `function on_data(line)
  local temp = line:match("temp=(%d+%.%d+)")
  if temp then
    plot("temp", tonumber(temp))
  end
  if line:match("READY") then
    send("AT+INFO\\r\\n")
  end
end

-- runs every 5s regardless of incoming data
timer(5000, function()
  log("still connected")
end)`

const WAIT_FOR_EXAMPLE = `send("AT\\r\\n")
local reply = wait_for("OK", 2000)
if reply then
  log("got: " .. reply)
else
  alert("device did not reply within 2s")
end`

/** Opened from Settings — the detailed reference with worked examples for
 * every feature. The short (i) popovers next to each control are the
 * quick reminder; this is the "read the manual" version. */
export function HelpGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">
            <BookOpenIcon /> User Guide
          </span>
          <button type="button" className="icon-button" aria-label="Close guide" onClick={onClose}>
            <XIcon />
          </button>
        </div>

        <div className="help-body">
          <section className="guide-section">
            <h3>Multi-pane Layout (Snap Layouts)</h3>
            <p>
              Drag a tab by its label and drop it on the left/right/top/bottom edge of any pane's
              content area to split the workspace and view two tabs side by side — drop on the edge
              of an existing pane again to split it further, nesting as many rows/columns as you
              need. A thin divider appears between panes; drag it to resize.
            </p>
            <p>
              To merge panes back, drag a tab onto another pane's tab strip (or drop it in the
              middle of that pane's content area instead of an edge) — the tab moves there, and if
              that was the last tab in its old pane, the now-empty pane and its split collapse away
              automatically. Clicking anywhere in a pane focuses it, which is what <kbd>Ctrl+1</kbd>
              -<kbd>9</kbd>, <kbd>Ctrl+W</kbd>, <kbd>Ctrl+L</kbd>, and <kbd>Space</kbd> act on.
            </p>
            <p>
              The Plotter is shared across the whole window rather than living inside one pane —
              toggle it from the top bar and pick its source tab from its own dropdown regardless of
              which pane that tab is currently showing in.
            </p>
          </section>

          <section className="guide-section">
            <h3>Serial Monitor</h3>
            <p>
              Click <b>+</b> in the tab strip (or <kbd>Ctrl+N</kbd>) to connect. Each connection is
              its own tab with independent settings. In the monitor toolbar:
            </p>
            <ul>
              <li>
                <b>mixed / hex / ascii</b> — switch how each line's bytes are displayed.
              </li>
              <li>
                <b>delta / abs / off</b> — timestamp relative to the first line, wall-clock time, or
                hidden.
              </li>
              <li>
                <b>Pause</b> (or <kbd>Space</kbd>) freezes the view without losing incoming data —
                Resume shows how many lines arrived while paused.
              </li>
              <li>
                The disk icon starts logging raw + timestamped output to a file, rotated at 50 MB
                (serial connections only).
              </li>
              <li>
                Lines matching common log formats (ESP-IDF's <code>E (328) wifi: ...</code>,{' '}
                <code>[ERROR]</code>, or a plain <code>WARN:</code> prefix) are auto-colored by
                level — no setup needed, this runs alongside filters/search.
              </li>
              <li>
                The bar at the bottom of the monitor shows live bytes/s, lines/s, error count, and
                uptime for the tab.
              </li>
            </ul>
            <p>
              Enable <b>Auto-reconnect</b> when connecting over serial to have the tab reopen
              automatically if the device is unplugged and replugged (matched by USB vendor/product
              id + serial number, not the OS port name, which can change). If the connection drops,
              use <b>Disconnect</b>/<b>Reconnect</b> in the tab — your COM port, baud rate, and
              other settings stay filled in.
            </p>
          </section>

          <section className="guide-section">
            <h3>TCP / UDP / WebSocket / MQTT Connections</h3>
            <p>
              The <b>New connection</b> panel's segmented control isn't limited to Serial — pick{' '}
              <b>TCP Client</b>, <b>TCP Server</b>, <b>UDP</b>, <b>WS Client</b>, <b>WS Server</b>,
              or <b>MQTT</b> instead, and the tab that opens behaves exactly like a serial one:
              filters, triggers, macros, the script engine, and the plotter all work unmodified
              since they only ever see a stream of bytes, not the transport underneath.
            </p>
            <ul>
              <li>
                <b>TCP Client</b> — connect out to a device's IP/port, e.g. a Wi-Fi module exposing
                a raw TCP console on <code>192.168.1.50:23</code>.
              </li>
              <li>
                <b>TCP Server</b> — listen on a local port and wait for the device to connect in
                instead (useful when the device only supports outbound connections). Handles one
                client at a time.
              </li>
              <li>
                <b>UDP</b> — bind a local port to receive on, and optionally set a remote host/port
                to send to. Broadcast addresses (e.g. <code>192.168.1.255</code>) work too.
              </li>
              <li>
                <b>WS Client</b> — connect to a WebSocket endpoint by full URL, e.g.{' '}
                <code>ws://192.168.1.1:81/</code> (an ESP32 running a WebSocket server is a common
                target). <b>WS Server</b> listens on a local port instead and waits for a client to
                connect in, handling one at a time like TCP Server. Incoming text messages appear as
                one monitor line each; binary messages pass through unmodified. Everything you send
                — text or hex — goes out as a binary WebSocket frame, so raw/binary protocols
                round-trip correctly; encrypted <code>wss://</code> endpoints aren't supported yet.
              </li>
              <li>
                <b>MQTT</b> — connect to a broker (host/port, optional username/password), subscribe
                to a topic filter (e.g. <code>#</code> for everything, or{' '}
                <code>devices/+/telemetry</code> for one level of wildcard), and set a publish topic
                for the Send panel. Each incoming message appears as a <code>topic: payload</code>{' '}
                line; the client reconnects to the broker on its own if the connection drops, so
                brief network blips don't need any action from you.
              </li>
            </ul>
            <p>
              <b>Example — watch and command an MQTT device:</b> broker{' '}
              <code>broker.hivemq.com:1883</code>, subscribe topic{' '}
              <code>devices/kitchen-sensor/#</code>, publish topic{' '}
              <code>devices/kitchen-sensor/cmd</code>. Incoming readings show up as{' '}
              <code>devices/kitchen-sensor/temp: 24.5</code>; typing <code>reboot</code> in the send
              box publishes it straight to the cmd topic.
            </p>
            <p>
              <b>Finding devices:</b> for TCP Client, WS Client, and MQTT targets, the{' '}
              <b>Scan LAN</b> button below the connection fields browses the local network via
              mDNS/DNS-SD for a chosen service type (HTTP, MQTT, Arduino OTA, ESPHome, WebSocket)
              and lists what it finds — click a result to fill in the host and port automatically.
              Devices must advertise themselves via mDNS (most IoT firmware frameworks do) and be on
              the same subnet.
            </p>
          </section>

          <section className="guide-section">
            <h3>SSH Terminal</h3>
            <p>
              Pick <b>SSH</b> in the New connection panel and enter host, port, username, and
              password. Unlike the other connection kinds, an SSH tab opens a real interactive
              terminal (a PTY, rendered with an actual terminal emulator) instead of a line-oriented
              monitor — there's no raw-log toggle, no Send panel, and no filters/triggers/script
              engine, since those all assume a stream of discrete lines rather than a live shell.
              The terminal resizes itself (and tells the remote shell) whenever its pane changes
              size, including when you split or merge panes.
            </p>
            <p>
              While an SSH tab is focused, <kbd>Ctrl+W</kbd> and <kbd>Ctrl+L</kbd> go to the shell
              (delete word / clear screen) instead of being caught as the app's close-tab /
              clear-log shortcuts.
            </p>
            <p>
              Two current limitations worth knowing: authentication is password-only (no key-based
              auth yet), and the host key isn't verified against a known-hosts list — any server's
              key is accepted, so this isn't yet safe against an on-path attacker impersonating the
              host.
            </p>
          </section>

          <section className="guide-section">
            <h3>RS485 &amp; Modbus RTU</h3>
            <p>
              For RS485 transceivers whose DE/RE direction pin has no auto-direction circuitry
              (common on bare MAX485-style breakout boards, unlike most all-in-one USB-RS485
              dongles), check <b>RS485 half-duplex (auto RTS toggle)</b> when connecting over
              Serial. RTS is then asserted right before every write and held until the bytes have
              actually finished shifting out at the configured baud rate, then released — timed from
              the baud rate and frame size, not a fixed guess, so the last byte doesn't get clipped.
              The manual RTS button in the signal bar is disabled while this is on, since toggling
              it by hand would fight the automatic control.
            </p>
            <p>Two sidebar tools speak Modbus on top of a connection:</p>
            <ul>
              <li>
                <b>Modbus Master</b> (gauge icon) — build a one-shot request (slave address,
                function code, start address, quantity or value, timeout) against a real Modbus RTU
                device and see the parsed response, or set up <b>poll rules</b> to read a register
                repeatedly on an interval — each rule's value also feeds the Plotter automatically,
                using the rule's label as the channel name. Only one request is ever in flight on
                the bus at a time, whether it came from a manual click or a poll rule, since RS485
                is half-duplex. The Master also works on a <b>TCP Client</b> tab: connect to a
                Modbus TCP device or gateway (port <code>502</code> by convention) and the same
                requests go out MBAP-framed as <b>Modbus TCP</b> — the "Slave address" field becomes
                the Unit ID. The Slave emulator remains serial-only.
              </li>
              <li>
                <b>Modbus Slave</b> (chip icon) — emulate a Modbus RTU device to test a real master
                against. Set a slave address, fill in whichever coils/discrete inputs/holding
                registers/input registers you want it to answer for, click <b>Start listening</b>,
                and it responds to matching requests automatically — including a spec-correct
                exception response if the master asks for a register you haven't added. It keeps
                listening in the background even if you switch to a different sidebar panel or tab.
                A tab can't run both Master polling and Slave listening at once — enabling one
                disables the other, since one RS485 bus can't sensibly be both roles at the same
                time.
              </li>
            </ul>
            <p>
              <b>Example — read holding register 0 from slave address 1:</b> in Modbus Master, set
              slave address <code>1</code>, function <code>03 Read Holding Registers</code>, start
              address <code>0</code>, quantity <code>1</code>, then Send. On the wire this is the
              request <code>01 03 00 00 00 01 84 0A</code> (the trailing two bytes are the CRC16).
              You can see this exact codec in action without any hardware at all: open Modbus Slave
              on a second tab connected to the other end of a loopback/null-modem pair, add holding
              register <code>0</code> with some value, enable <b>Start listening</b>, and send the
              request from the first tab's Master panel to watch the round trip end to end.
            </p>
          </section>

          <section className="guide-section">
            <h3>Saved Profiles, Scripts &amp; Presets</h3>
            <p>
              Four places share the same small save/load control — a dropdown plus a disk icon
              (save) and trash icon (delete): the <b>Profile</b> picker in the New connection panel,
              <b> Script</b> in the script panel, and <b>Preset</b> in both Filters and Triggers.
              Picking an item from the dropdown loads it immediately; the disk icon prompts for a
              name and saves whatever is currently filled in (overwriting if you reuse a name); the
              trash icon deletes whichever item is selected. Everything is stored locally in the
              app, so it's there next time you open EDT — nothing to export/import manually.
            </p>
            <p>
              <b>Example:</b> set up a TCP Client profile for your dev board once, save it as{' '}
              <code>dev-board</code>, and pick it from the Profile dropdown on any future connection
              instead of retyping the host/port. Same idea for a Lua script you use across multiple
              tabs, or a filter preset like <code>ERROR|WARN</code> + exclude <code>heartbeat</code>{' '}
              that you'd otherwise rebuild by hand each time.
            </p>
          </section>

          <section className="guide-section">
            <h3>Search &amp; Bookmarks</h3>
            <p>
              Press <kbd>Ctrl+F</kbd> to open an in-buffer regex search bar. <kbd>Enter</kbd> /{' '}
              <kbd>Shift+Enter</kbd> jump to the next/previous match; <kbd>Escape</kbd> closes it.
              Search runs over whatever filters currently have applied, so you can narrow down with
              a filter first and search within that subset.
            </p>
            <p>
              Click the bookmark icon on any line (or use a <b>Bookmark line</b> trigger action, see
              Triggers below) to mark it. The bookmark arrows in the toolbar jump between marked
              lines in order — handy for flagging a handful of interesting moments in a long capture
              and revisiting them without re-reading everything in between.
            </p>
          </section>

          <section className="guide-section">
            <h3>Send Panel &amp; Macro Recorder</h3>
            <p>
              Type in the send box and press Enter, or switch to <b>hex</b> mode to send raw bytes
              like <code>01 02 FF</code>. Pick the line ending (None/CR/LF/CRLF) once per tab. Arrow
              up/down recalls previous sends.
            </p>
            <p>
              The second dropdown next to Line Ending is <b>Checksum</b> — pick CRC16 (Modbus),
              CRC16 (CCITT), CRC8, XOR, or Sum, and it's appended to every message you send from
              this tab, in both text and hex mode (a Modbus RTU frame typed as hex, for instance,
              gets the correct CRC16 tacked on automatically). Turning a checksum on also suppresses
              the line ending for that send — a trailing CR/LF after a binary checksum would corrupt
              the frame — so there's nothing else to configure for binary protocols.
            </p>
            <p>
              The macro recorder lives in the sidebar next to Filters/Triggers/Script — click the
              repeat icon to open it.
            </p>
            <p>
              <b>Example — record and replay a test sequence:</b>
            </p>
            <ol>
              <li>
                Open <b>Macro</b> in the sidebar, click <b>Record</b>.
              </li>
              <li>
                Send <code>AT</code> from the send panel, wait a moment, then send{' '}
                <code>AT+GMR</code>.
              </li>
              <li>
                Click <b>Record</b> again to stop.
              </li>
              <li>
                Click <b>Play</b> any time to replay both commands with the same real delay between
                them, or edit a step's delay / remove it right there in the panel.
              </li>
            </ol>
          </section>

          <section className="guide-section">
            <h3>Quick Commands</h3>
            <p>
              The slim row above the send box is for one-click, frequently-reused commands (think AT
              commands, a reboot string, a status query) — unlike the macro recorder, there's no
              sequence or delay involved, each chip just fires that one command immediately when
              clicked.
            </p>
            <p>
              Commands are grouped into named <b>profiles</b> (the dropdown on the left) so you can
              keep separate sets for different devices — saved permanently, and shared by every tab,
              not just the one you created them in. Pick a profile to show its commands; the +
              button next to the dropdown creates a new one.
            </p>
            <ul>
              <li>
                <b>+ Add</b> at the end of the row opens a small form below for the command's label
                (optional — falls back to showing the command text itself), the text or hex payload
                to send, and a hex toggle.
              </li>
              <li>Click the pencil on any chip to edit it, or the × to remove it.</li>
              <li>
                Drag a chip and drop it on another to reorder — the order is the priority, and is
                saved back to the profile immediately.
              </li>
            </ul>
          </section>

          <section className="guide-section">
            <h3>Filters</h3>
            <p>
              Click <b>Filters</b> in the monitor toolbar. Each rule is a regex, either{' '}
              <b>include</b> (only show matching lines) or <b>exclude</b> (hide matching lines).
              Rules stack, matches are highlighted, and each rule shows a live count.
            </p>
            <p>
              <b>Example:</b> add an include rule <code>ERROR|WARN</code> to only see
              errors/warnings, plus an exclude rule <code>heartbeat</code> to additionally hide a
              noisy keep-alive line.
            </p>
          </section>

          <section className="guide-section">
            <h3>Triggers</h3>
            <p>
              Click <b>Triggers</b> to react automatically when a line matches a pattern — no code
              needed. Each rule is a regex plus one action:
            </p>
            <ul>
              <li>
                <b>Send</b> — pattern <code>READY</code> → send <code>AT+INFO\r\n</code> to
                auto-query the device right after it boots.
              </li>
              <li>
                <b>Play sound</b> — pattern <code>ERROR</code> → get an audible alert without
                watching the screen.
              </li>
              <li>
                <b>Write to file</b> — pattern <code>FAIL</code> → append every failing line to its
                own log file.
              </li>
              <li>
                <b>Bookmark line</b> — pattern <code>ERROR</code> → mark every error line so you can
                jump between them later with the bookmark navigator.
              </li>
            </ul>
          </section>

          <section className="guide-section">
            <h3>Script Engine (Lua)</h3>
            <p>
              Click <b>Script</b> to write a small Lua program for that tab. Available functions:
            </p>
            <ul>
              <li>
                <code>on_data(line)</code> — define this function and it's called once per received
                line.
              </li>
              <li>
                <code>send(text)</code> / <code>send_hex(hex)</code> — write back to the device.
              </li>
              <li>
                <code>wait_for(pattern, timeout_ms)</code> — blocks until a matching line arrives or
                the timeout elapses; returns the matched line or <code>nil</code>.
              </li>
              <li>
                <code>log(msg)</code> / <code>alert(msg)</code> — write to the script console.
              </li>
              <li>
                <code>plot(channel, value)</code> — push a point straight into the plotter, if this
                tab is its selected source.
              </li>
              <li>
                <code>timer(interval_ms, fn)</code> — run <code>fn</code> repeatedly on a schedule.
              </li>
            </ul>
            <p>
              <b>Example — extract a value and auto-reply once ready:</b>
            </p>
            <pre className="guide-code">{SCRIPT_EXAMPLE}</pre>
            <p>
              <b>
                Example — expect-style request/response with <code>wait_for</code>:
              </b>
            </p>
            <pre className="guide-code">{WAIT_FOR_EXAMPLE}</pre>
            <p>
              This is a convenience sandbox (no <code>os</code>/<code>io</code>/<code>require</code>
              , each callback capped at ~2s) for scripts you write yourself — not a hardened
              boundary against malicious code.
            </p>
          </section>

          <section className="guide-section">
            <h3>Plotter</h3>
            <p>
              Toggle the chart icon in the top bar (<kbd>Ctrl+Shift+P</kbd>) and pick a source tab.
              Lines are auto-parsed as CSV (<code>1.2,3.4</code>), space-separated, or{' '}
              <code>key:value</code> pairs (e.g. <code>temp:24.5,hum:51.2</code>) — up to 8
              channels.
            </p>
            <p>
              <b>Example — extract a value that isn't in a recognized format:</b> a log line like{' '}
              <code>Current temperature reading: 24.5C</code> won't auto-parse. Open{' '}
              <b>Extractors</b> and add pattern <code>temp=(\d+\.\d+)</code> → channel{' '}
              <code>temp</code> (adjust the pattern to match your actual log text) to pull the
              number out anyway. A script's <code>plot(...)</code> calls land on the same chart too.
            </p>
            <p>The toolbar also has a set of analysis tools:</p>
            <ul>
              <li>
                <b>Math</b> — derived channels computed from real ones: A+B, A−B, A×B, A÷B, moving
                average, derivative (units/second), or RMS over a sample window. They show up in the
                legend prefixed with <code>ƒ</code> and behave like normal channels everywhere —
                stats, FFT, CSV export.
              </li>
              <li>
                <b>Levels</b> — horizontal alert lines. Pick a channel and a value; a dashed line is
                drawn at that level and a beep sounds whenever the channel crosses it upward.
                <b> Example:</b> channel <code>temp</code> &gt; <code>80</code> beeps the moment a
                temperature reading exceeds 80.
              </li>
              <li>
                <b>Stats</b> — a live strip showing each visible channel's min / max / avg /
                peak-to-peak and an estimated frequency (blank for flat or non-periodic signals).
              </li>
              <li>
                <b>FFT</b> — switches the chart to the frequency domain: the current buffer is
                resampled to a uniform rate, a window function (Hann by default, Hamming or
                rectangular selectable) is applied, and the amplitude spectrum is shown with Hz on
                the x axis. Needs at least 64 samples. Note: values between real samples are held
                constant by the plotter's ingest (a zero-order hold), which adds small artificial
                harmonics — fine for spotting dominant frequencies, not for precision measurement.
              </li>
              <li>
                <b>CSV / PNG</b> — export the whole buffer (timestamps + every channel including
                math channels) as CSV, or the chart as a PNG image (the HTML legend below the chart
                isn't part of the image).
              </li>
            </ul>
          </section>

          <section className="guide-section">
            <h3>Flash ESP32</h3>
            <ol>
              <li>
                Open the flash panel (zap icon or <kbd>Ctrl+Shift+F</kbd>), keep <b>ESP32</b>{' '}
                selected.
              </li>
              <li>Pick the port and baud rate, then Detect chip.</li>
              <li>
                Add segments — <b>Example:</b> offset <code>0x1000</code> for the bootloader,{' '}
                <code>0x8000</code> for the partition table, <code>0x10000</code> for the app binary
                (offsets vary by project — check your build output).
              </li>
              <li>Click Flash; Erase chip wipes everything first if needed.</li>
            </ol>
          </section>

          <section className="guide-section">
            <h3>Flash STM32</h3>
            <p>Requires STM32CubeProgrammer installed — the panel detects it automatically.</p>
            <ul>
              <li>
                <b>ST-Link (SWD)</b> — for boards with an on-board or external ST-Link.
              </li>
              <li>
                <b>UART bootloader</b> — for boards without one; put the MCU in bootloader mode via
                BOOT0 first.
              </li>
            </ul>
            <p>
              Option-byte writes (e.g. RDP level) require an explicit confirmation dialog — read it
              before confirming, as some settings can permanently affect debug access.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
