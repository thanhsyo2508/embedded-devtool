//! YAML test-suite runner backing `edt-cli test` (Giai đoạn 3, "CLI test
//! runner") — flash → send → expect steps against a real device over
//! serial, with JUnit XML / HTML report output for CI. Only compiled with
//! the `cli` feature (needs `serde_yaml`, an edt-cli-only dependency —
//! see Cargo.toml), so the GUI build never touches this module.
//!
//! Tauri-free like the rest of the core the CLI reuses (see
//! `bin/edt-cli.rs`'s module doc) — this only talks to `PortManager`/
//! `EventBus` directly, polled rather than through the event-emitting
//! bridge that only makes sense with a window to emit to.

use std::fmt::Write as _;
use std::time::{Duration, Instant};

use crossbeam_channel::Receiver;
use regex::Regex;
use serde::Deserialize;

use crate::core::event_bus::{Event, EventBus};
use crate::flash::esp32::{self, FlashSegmentReq};
use crate::serial::manager::{DataBitsDto, FlowControlDto, ParityDto, StopBitsDto};
use crate::serial::{OpenPortRequest, PortManager};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestSuite {
    pub port: String,
    #[serde(default = "default_baud")]
    pub baud: u32,
    /// Default `expect` timeout for steps that don't set their own.
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    pub steps: Vec<Step>,
    /// Posted a pass/fail summary to after the suite finishes -- accepts
    /// either a Slack or a Discord incoming-webhook URL (see
    /// `send_webhook`'s doc comment for how one payload satisfies both).
    /// Optional: most suites just rely on the CLI's own exit code for CI.
    pub webhook_url: Option<String>,
}

fn default_baud() -> u32 {
    115_200
}

fn default_timeout_ms() -> u64 {
    2000
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub name: Option<String>,
    pub flash: Option<FlashStep>,
    pub send: Option<String>,
    pub send_hex: Option<String>,
    /// A regex the incoming stream must match before this step passes —
    /// runs after `send`/`sendHex` in the same step, so "send a command,
    /// then wait for its response" is one step, not two.
    pub expect: Option<String>,
    pub timeout_ms: Option<u64>,
    pub delay_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashStep {
    pub segments: Vec<FlashSegmentYaml>,
}

#[derive(Debug, Deserialize)]
pub struct FlashSegmentYaml {
    pub offset: String,
    pub path: String,
}

pub fn parse_suite(yaml: &str) -> Result<TestSuite, String> {
    serde_yaml::from_str(yaml).map_err(|e| format!("invalid test suite: {e}"))
}

#[derive(Debug, Clone)]
pub struct StepResult {
    pub name: String,
    pub passed: bool,
    pub message: String,
    pub duration: Duration,
    /// Whether this step counts toward the pass/fail total — a `flash` or
    /// `expect` step is a real assertion; a bare `send`/`delayMs` step is
    /// just an action, reported for visibility but not counted as a test
    /// (so a suite of pure setup steps doesn't read as "0 tests, 0 failed"
    /// and get treated as a no-op by CI).
    pub is_assertion: bool,
}

pub struct SuiteReport {
    pub port: String,
    pub results: Vec<StepResult>,
}

impl SuiteReport {
    fn assertions(&self) -> impl Iterator<Item = &StepResult> {
        self.results.iter().filter(|r| r.is_assertion)
    }

    pub fn failed_count(&self) -> usize {
        self.assertions().filter(|r| !r.passed).count()
    }

    pub fn assertion_count(&self) -> usize {
        self.assertions().count()
    }

    pub fn passed(&self) -> bool {
        self.failed_count() == 0
    }
}

fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    let cleaned: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    if !cleaned.len().is_multiple_of(2) {
        return Err("sendHex must have an even number of hex digits".to_string());
    }
    (0..cleaned.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&cleaned[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

fn parse_offset(s: &str) -> Result<u32, String> {
    let trimmed = s.trim();
    let hex = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"));
    match hex {
        Some(h) => u32::from_str_radix(h, 16).map_err(|e| format!("bad offset {s:?}: {e}")),
        None => trimmed
            .parse()
            .map_err(|e| format!("bad offset {s:?}: {e}")),
    }
}

/// Runs every step in order, stopping early if one fails (a suite is a
/// sequential commissioning/test script — a failed flash or an
/// unanswered command means everything after it is meaningless). Calls
/// `on_step` as each result comes in so the CLI can print progress live
/// instead of only after the whole suite finishes.
pub fn run_suite(suite: &TestSuite, mut on_step: impl FnMut(&StepResult)) -> SuiteReport {
    let event_bus = EventBus::new();
    let manager = PortManager::new(event_bus.clone());
    let stream_id = "test-runner";

    let mut results = Vec::new();
    let open_req = OpenPortRequest {
        id: stream_id.to_string(),
        port_name: suite.port.clone(),
        baud_rate: suite.baud,
        data_bits: DataBitsDto::Eight,
        parity: ParityDto::None,
        stop_bits: StopBitsDto::One,
        flow_control: FlowControlDto::None,
        auto_reconnect: false,
        rs485_auto_rts: false,
    };
    if let Err(e) = manager.open(open_req) {
        let result = StepResult {
            name: format!("open {}", suite.port),
            passed: false,
            message: e,
            duration: Duration::ZERO,
            is_assertion: true,
        };
        on_step(&result);
        results.push(result);
        return SuiteReport {
            port: suite.port.clone(),
            results,
        };
    }

    let rx = event_bus.subscribe();
    let mut buffer: Vec<u8> = Vec::new();

    for (index, step) in suite.steps.iter().enumerate() {
        let result = execute_step(
            &manager,
            stream_id,
            &rx,
            &mut buffer,
            &suite.port,
            suite.baud,
            step,
            suite.timeout_ms,
            index,
        );
        on_step(&result);
        let should_stop = !result.passed;
        results.push(result);
        if should_stop {
            break;
        }
    }

    manager.close(stream_id).ok();
    SuiteReport {
        port: suite.port.clone(),
        results,
    }
}

#[allow(clippy::too_many_arguments)]
fn execute_step(
    manager: &PortManager,
    stream_id: &str,
    rx: &Receiver<Event>,
    buffer: &mut Vec<u8>,
    port: &str,
    baud: u32,
    step: &Step,
    default_timeout_ms: u64,
    index: usize,
) -> StepResult {
    let name = step
        .name
        .clone()
        .unwrap_or_else(|| format!("step {}", index + 1));
    let started = Instant::now();
    let mut is_assertion = false;
    let mut messages = Vec::new();

    macro_rules! fail {
        ($msg:expr) => {
            return StepResult {
                name,
                passed: false,
                message: $msg,
                duration: started.elapsed(),
                is_assertion: true,
            }
        };
    }

    if let Some(flash_step) = &step.flash {
        is_assertion = true;
        let segments: Result<Vec<FlashSegmentReq>, String> = flash_step
            .segments
            .iter()
            .map(|s| {
                Ok(FlashSegmentReq {
                    offset: parse_offset(&s.offset)?,
                    path: s.path.clone(),
                })
            })
            .collect();
        match segments.and_then(|segs| esp32::flash_binaries(port, baud, &segs, |_| {})) {
            Ok(()) => messages.push("flashed".to_string()),
            Err(e) => fail!(e),
        }
    }

    if let Some(text) = &step.send {
        match manager.write(stream_id, text.as_bytes()) {
            Ok(()) => messages.push(format!("sent {text:?}")),
            Err(e) => fail!(e),
        }
    }

    if let Some(hex) = &step.send_hex {
        match hex_decode(hex).and_then(|bytes| manager.write(stream_id, &bytes).map(|_| bytes)) {
            Ok(bytes) => messages.push(format!("sent {} hex byte(s)", bytes.len())),
            Err(e) => fail!(e),
        }
    }

    if let Some(pattern) = &step.expect {
        is_assertion = true;
        let re = match Regex::new(pattern) {
            Ok(re) => re,
            Err(e) => fail!(format!("invalid pattern {pattern:?}: {e}")),
        };
        let timeout = Duration::from_millis(step.timeout_ms.unwrap_or(default_timeout_ms));
        let deadline = Instant::now() + timeout;
        loop {
            if let Ok(text) = std::str::from_utf8(buffer) {
                if re.is_match(text) {
                    messages.push(format!("matched {pattern:?}"));
                    break;
                }
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                fail!(format!(
                    "timed out after {}ms waiting for {pattern:?}",
                    timeout.as_millis()
                ));
            }
            if let Ok(Event::DataReceived {
                stream_id: sid,
                data,
            }) = rx.recv_timeout(remaining.min(Duration::from_millis(100)))
            {
                if sid == stream_id {
                    buffer.extend_from_slice(&data);
                }
            }
        }
    }

    if let Some(ms) = step.delay_ms {
        std::thread::sleep(Duration::from_millis(ms));
        messages.push(format!("waited {ms}ms"));
    }

    if messages.is_empty() {
        fail!("step has no action (flash/send/sendHex/expect/delayMs)".to_string());
    }

    StepResult {
        name,
        passed: true,
        message: messages.join("; "),
        duration: started.elapsed(),
        is_assertion,
    }
}

fn build_webhook_message(report: &SuiteReport) -> String {
    let status = if report.passed() { "PASS" } else { "FAIL" };
    let passed = report.assertion_count() - report.failed_count();
    format!(
        "edt-cli test [{status}] {} — {passed}/{} assertions passed",
        report.port,
        report.assertion_count(),
    )
}

/// Posts a pass/fail summary to `url` after a suite finishes. Slack and
/// Discord incoming webhooks expect the message under a different JSON
/// key (`text` for Slack, `content` for Discord) -- sending both in the
/// same body lets one `webhookUrl` work with either without the suite
/// needing to say which service it's pointed at, since each service just
/// ignores the field it doesn't recognize.
pub fn send_webhook(report: &SuiteReport, url: &str) -> Result<(), String> {
    let message = build_webhook_message(report);
    let body = serde_json::json!({ "text": message, "content": message }).to_string();
    ureq::post(url)
        .header("Content-Type", "application/json")
        .send(body)
        .map(|_| ())
        .map_err(|e| format!("webhook request failed: {e}"))
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn write_junit_report(report: &SuiteReport, path: &str) -> Result<(), String> {
    let total_secs: f64 = report
        .results
        .iter()
        .map(|r| r.duration.as_secs_f64())
        .sum();
    let mut xml = String::new();
    let _ = write!(
        xml,
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<testsuite name=\"edt-cli test\" tests=\"{}\" failures=\"{}\" time=\"{total_secs:.3}\">\n",
        report.assertion_count(),
        report.failed_count(),
    );
    for r in report.assertions() {
        let _ = writeln!(
            xml,
            "  <testcase name=\"{}\" time=\"{:.3}\">",
            xml_escape(&r.name),
            r.duration.as_secs_f64(),
        );
        if !r.passed {
            let _ = writeln!(
                xml,
                "    <failure message=\"{}\">{}</failure>",
                xml_escape(&r.message),
                xml_escape(&r.message),
            );
        }
        xml.push_str("  </testcase>\n");
    }
    xml.push_str("</testsuite>\n");
    std::fs::write(path, xml).map_err(|e| format!("failed to write {path}: {e}"))
}

pub fn write_html_report(report: &SuiteReport, path: &str) -> Result<(), String> {
    let mut rows = String::new();
    for r in &report.results {
        let status_class = if r.passed { "pass" } else { "fail" };
        let status_text = if r.passed { "PASS" } else { "FAIL" };
        let _ = writeln!(
            rows,
            "<tr class=\"{status_class}\"><td>{}</td><td>{status_text}</td><td>{:.3}s</td><td>{}</td></tr>",
            html_escape(&r.name),
            r.duration.as_secs_f64(),
            html_escape(&r.message),
        );
    }
    let overall = if report.passed() { "PASS" } else { "FAIL" };
    let html = format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><title>edt-cli test report</title>
<style>
body {{ font-family: system-ui, sans-serif; margin: 24px; }}
h1 {{ font-size: 18px; }}
table {{ border-collapse: collapse; width: 100%; }}
th, td {{ text-align: left; padding: 6px 10px; border-bottom: 1px solid #ddd; font-size: 13px; }}
tr.pass td:nth-child(2) {{ color: #1a7f37; font-weight: 600; }}
tr.fail td:nth-child(2) {{ color: #c1121f; font-weight: 600; }}
.summary {{ margin-bottom: 12px; }}
</style></head><body>
<h1>edt-cli test report — {port}</h1>
<p class="summary">{assertions} assertion(s), {failed} failed — overall: <strong>{overall}</strong></p>
<table><thead><tr><th>Step</th><th>Status</th><th>Duration</th><th>Detail</th></tr></thead><tbody>
{rows}</tbody></table>
</body></html>
"#,
        port = html_escape(&report.port),
        assertions = report.assertion_count(),
        failed = report.failed_count(),
    );
    std::fs::write(path, html).map_err(|e| format!("failed to write {path}: {e}"))
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_minimal_suite() {
        let yaml = r#"
port: COM3
steps:
  - name: ping
    send: "AT\r\n"
    expect: "OK"
"#;
        let suite = parse_suite(yaml).unwrap();
        assert_eq!(suite.port, "COM3");
        assert_eq!(suite.baud, 115_200);
        assert_eq!(suite.timeout_ms, 2000);
        assert_eq!(suite.steps.len(), 1);
        assert_eq!(suite.steps[0].expect.as_deref(), Some("OK"));
    }

    #[test]
    fn parse_offset_accepts_hex_and_decimal() {
        assert_eq!(parse_offset("0x1000").unwrap(), 0x1000);
        assert_eq!(parse_offset("4096").unwrap(), 4096);
        assert!(parse_offset("nope").is_err());
    }

    #[test]
    fn hex_decode_round_trips() {
        assert_eq!(hex_decode("41 54 0d 0a").unwrap(), b"AT\r\n".to_vec());
        assert!(hex_decode("abc").is_err());
    }

    #[test]
    fn suite_report_counts_only_assertions() {
        let report = SuiteReport {
            port: "COM3".to_string(),
            results: vec![
                StepResult {
                    name: "send".to_string(),
                    passed: true,
                    message: String::new(),
                    duration: Duration::ZERO,
                    is_assertion: false,
                },
                StepResult {
                    name: "expect".to_string(),
                    passed: false,
                    message: "timeout".to_string(),
                    duration: Duration::ZERO,
                    is_assertion: true,
                },
            ],
        };
        assert_eq!(report.assertion_count(), 1);
        assert_eq!(report.failed_count(), 1);
        assert!(!report.passed());
    }

    #[test]
    fn webhook_url_defaults_to_none() {
        let yaml = r#"
port: COM3
steps:
  - name: ping
    send: "AT\r\n"
    expect: "OK"
"#;
        let suite = parse_suite(yaml).unwrap();
        assert_eq!(suite.webhook_url, None);

        let yaml_with_webhook = r#"
port: COM3
webhookUrl: "https://hooks.example.com/abc"
steps:
  - name: ping
    send: "AT\r\n"
    expect: "OK"
"#;
        let suite = parse_suite(yaml_with_webhook).unwrap();
        assert_eq!(
            suite.webhook_url.as_deref(),
            Some("https://hooks.example.com/abc")
        );
    }

    #[test]
    fn webhook_message_reports_pass_and_fail_counts() {
        let passing = SuiteReport {
            port: "COM3".to_string(),
            results: vec![StepResult {
                name: "expect".to_string(),
                passed: true,
                message: String::new(),
                duration: Duration::ZERO,
                is_assertion: true,
            }],
        };
        let message = build_webhook_message(&passing);
        assert!(message.contains("[PASS]"));
        assert!(message.contains("COM3"));
        assert!(message.contains("1/1"));

        let failing = SuiteReport {
            port: "COM3".to_string(),
            results: vec![StepResult {
                name: "expect".to_string(),
                passed: false,
                message: "timeout".to_string(),
                duration: Duration::ZERO,
                is_assertion: true,
            }],
        };
        let message = build_webhook_message(&failing);
        assert!(message.contains("[FAIL]"));
        assert!(message.contains("0/1"));
    }
}
