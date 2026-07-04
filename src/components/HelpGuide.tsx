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
            <h3>TCP / UDP / MQTT Connections</h3>
            <p>
              The <b>New connection</b> panel's segmented control isn't limited to Serial — pick{' '}
              <b>TCP Client</b>, <b>TCP Server</b>, <b>UDP</b>, or <b>MQTT</b> instead, and the tab
              that opens behaves exactly like a serial one: filters, triggers, macros, the script
              engine, and the plotter all work unmodified since they only ever see a stream of
              bytes, not the transport underneath.
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
