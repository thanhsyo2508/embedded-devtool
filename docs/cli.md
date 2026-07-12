# `edt-cli` — headless CLI

A separate binary from the GUI app (`edt`), for scripting and CI use — no
window, no Tauri runtime. It reuses the same Tauri-free core
(`serial::PortManager`, `flash::esp32`, ...) the GUI's commands wrap, just
polled directly instead of through the event-emitting bridge that only
makes sense with a window to emit to.

Not bundled with the GUI installer — build and run it separately.

## Build

```bash
cd src-tauri
cargo build --release --bin edt-cli --features cli
```

The binary lands at `src-tauri/target/release/edt-cli` (`.exe` on
Windows). The `cli` feature gates `clap`/`ctrlc`/`serde_yaml` so a normal
`cargo build`/`tauri build` for the GUI never compiles or links them.

## `edt-cli monitor`

Opens a serial port and streams its raw output to stdout until timeout or
Ctrl+C.

```bash
edt-cli monitor --port COM3 --baud 115200 [--timeout 60]
```

| Flag | Required | Description |
|---|---|---|
| `--port` | yes | OS port name, e.g. `COM3` or `/dev/ttyUSB0`. |
| `--baud` | no (default `115200`) | Baud rate. |
| `--timeout` | no | Stop after this many seconds; omit to run until Ctrl+C. |

Exits `1` if the port fails to open, or dies mid-session (device
unplugged — there's no auto-reconnect in this one-shot mode). Exits `0`
on a clean Ctrl+C or timeout.

Progress/status messages go to stderr; only the device's own bytes go to
stdout, so `edt-cli monitor --port COM3 | grep ERROR` works as expected.

## `edt-cli test`

Runs a YAML test suite — flash, then send commands and assert on the
responses — against a real device, and reports pass/fail with a
CI-friendly exit code.

```bash
edt-cli test --suite suite.yaml [--junit report.xml] [--html report.html]
```

| Flag | Required | Description |
|---|---|---|
| `--suite` | yes | Path to the test suite YAML file. |
| `--junit` | no | Write a JUnit XML report here (Jenkins/GitHub Actions consume this natively). |
| `--html` | no | Write a self-contained HTML report here. |

Exit code is `0` if every assertion passed, `1` otherwise (including a
suite that fails to parse, or a port that fails to open).

### Suite format

```yaml
port: COM3
baud: 115200 # optional, default 115200
timeoutMs: 2000 # optional, default 2000 — per-step `expect` timeout unless overridden

steps:
  - name: flash firmware # optional; auto-named "step N" if omitted
    flash:
      segments:
        - offset: "0x1000" # hex ("0x...") or decimal
          path: bootloader.bin
        - offset: "0x10000"
          path: firmware.bin

  - name: wait for boot
    delayMs: 2000

  - name: device responds to AT
    send: "AT\r\n" # raw text, sent as-is
    expect: "OK" # a regex the incoming stream must match

  - name: firmware version looks sane
    send: "AT+VERSION?\r\n"
    expect: "VERSION=\\d+\\.\\d+"
    timeoutMs: 1000 # overrides the suite-level default for this step

  - name: send a binary ping frame
    sendHex: "7e 01 00 00 7e" # hex-encoded bytes instead of text
    expect: "PONG"
```

A full working example is at [example-test-suite.yaml](example-test-suite.yaml).

**Step fields** — a step can combine several of these; they run in this
order within one step (so "send a command, then wait for its response"
is one step, not two):

| Field | Effect |
|---|---|
| `flash` | Flashes `segments` (offset/path pairs) to the port before continuing. |
| `send` | Writes the given text verbatim. |
| `sendHex` | Writes hex-encoded bytes (whitespace between pairs is ignored). |
| `expect` | Waits (up to `timeoutMs`, or the suite default) for the incoming stream to match this regex. |
| `delayMs` | Sleeps this many milliseconds. |

**Assertions vs. actions.** `flash` and `expect` steps count toward the
pass/fail total shown in reports; a bare `send`/`sendHex`/`delayMs` step
is just an action — reported for visibility (so you can see it happened)
but not counted as a test, the same way a plain setup line in a test
script isn't itself "a test".

**Execution stops at the first failed step** — a suite is a sequential
script, so a failed flash or an unanswered command means everything
after it is meaningless. Steps already run are still included in the
report; the ones after the failure simply never execute.

### Reports

- **Console** (stderr): a `[PASS]`/`[FAIL]` line per step as it runs,
  then a summary line (`N assertion(s), M failed.`).
- **JUnit XML** (`--junit`): one `<testcase>` per assertion step, with a
  `<failure>` element for failed ones — consumed natively by Jenkins'
  JUnit plugin and GitHub Actions' test-reporting actions.
- **HTML** (`--html`): a self-contained page listing every step (actions
  included) with pass/fail styling, for a human to skim after a run.

### Using it in CI

```yaml
# GitHub Actions example — a self-hosted runner with the device attached
- name: Flash and smoke-test
  run: |
    cd src-tauri
    cargo build --release --bin edt-cli --features cli
    ./target/release/edt-cli test --suite ../docs/example-test-suite.yaml --junit report.xml
- name: Publish test report
  if: always()
  uses: dorny/test-reporter@v1
  with:
    name: Device tests
    path: report.xml
    reporter: java-junit
```

CI-hosted runners generally can't reach real serial hardware — this is
meant for a self-hosted runner (or a local pre-push hook) with the
device physically attached.
