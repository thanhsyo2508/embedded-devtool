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
                The disk icon starts logging raw + timestamped output to a file, rotated at 50 MB.
              </li>
            </ul>
            <p>
              Enable <b>Auto-reconnect</b> when connecting to have the tab reopen automatically if
              the device is unplugged and replugged (matched by USB vendor/product id + serial
              number, not the OS port name, which can change).
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
