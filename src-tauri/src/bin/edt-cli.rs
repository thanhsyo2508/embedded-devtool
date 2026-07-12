//! Headless CLI for Embedded DevTool (Giai đoạn 3) — a separate binary from
//! the GUI app (`edt`), built only with `--features cli` (see Cargo.toml),
//! so a normal `cargo build`/`tauri build` never compiles or links `clap`/
//! `ctrlc` into the GUI. Reuses the same Tauri-free core (`edt_lib::serial`
//! etc.) the GUI's Tauri commands wrap, just polled directly instead of
//! through the 60fps event-emitting bridge that only makes sense with a
//! window to emit to.
//!
//! `monitor` was the first command; `test` (Giai đoạn 3's CLI test
//! runner) follows the same pattern.

use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use clap::{Parser, Subcommand};

use edt_lib::core::event_bus::EventBus;
use edt_lib::serial::manager::{DataBitsDto, FlowControlDto, ParityDto, StopBitsDto};
use edt_lib::serial::{OpenPortRequest, PortManager, PortState};
use edt_lib::testrunner;

#[derive(Parser)]
#[command(name = "edt-cli", version, about = "Headless CLI for Embedded DevTool")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Open a serial port and stream everything it sends to stdout.
    Monitor {
        /// OS port name, e.g. COM3 or /dev/ttyUSB0.
        #[arg(long)]
        port: String,
        #[arg(long, default_value_t = 115_200)]
        baud: u32,
        /// Stop after this many seconds; omit to run until Ctrl+C.
        #[arg(long)]
        timeout: Option<u64>,
    },
    /// Run a YAML test suite (flash → send → expect) against a real
    /// device and report pass/fail with a CI-friendly exit code.
    Test {
        /// Path to the test suite YAML file.
        #[arg(long)]
        suite: String,
        /// Write a JUnit XML report here (for Jenkins/GitHub Actions).
        #[arg(long)]
        junit: Option<String>,
        /// Write an HTML report here.
        #[arg(long)]
        html: Option<String>,
    },
}

fn main() {
    let cli = Cli::parse();
    let exit_code = match cli.command {
        Command::Monitor {
            port,
            baud,
            timeout,
        } => run_monitor(&port, baud, timeout),
        Command::Test { suite, junit, html } => run_test(&suite, junit.as_deref(), html.as_deref()),
    };
    std::process::exit(exit_code);
}

fn run_test(suite_path: &str, junit_path: Option<&str>, html_path: Option<&str>) -> i32 {
    let yaml = match std::fs::read_to_string(suite_path) {
        Ok(y) => y,
        Err(e) => {
            eprintln!("error: failed to read {suite_path}: {e}");
            return 1;
        }
    };
    let suite = match testrunner::parse_suite(&yaml) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error: {e}");
            return 1;
        }
    };

    eprintln!(
        "Running {} step(s) against {}...",
        suite.steps.len(),
        suite.port
    );
    let report = testrunner::run_suite(&suite, |result| {
        let status = if result.passed { "PASS" } else { "FAIL" };
        eprintln!(
            "  [{status}] {} ({:.3}s) — {}",
            result.name,
            result.duration.as_secs_f64(),
            result.message,
        );
    });

    if let Some(path) = junit_path {
        if let Err(e) = testrunner::write_junit_report(&report, path) {
            eprintln!("warning: {e}");
        }
    }
    if let Some(path) = html_path {
        if let Err(e) = testrunner::write_html_report(&report, path) {
            eprintln!("warning: {e}");
        }
    }

    eprintln!(
        "\n{} assertion(s), {} failed.",
        report.assertion_count(),
        report.failed_count(),
    );
    if report.passed() {
        0
    } else {
        1
    }
}

const STREAM_ID: &str = "cli-monitor";
const POLL_INTERVAL: Duration = Duration::from_millis(20);

fn run_monitor(port: &str, baud: u32, timeout_secs: Option<u64>) -> i32 {
    let manager = PortManager::new(EventBus::new());
    let req = OpenPortRequest {
        id: STREAM_ID.to_string(),
        port_name: port.to_string(),
        baud_rate: baud,
        data_bits: DataBitsDto::Eight,
        parity: ParityDto::None,
        stop_bits: StopBitsDto::One,
        flow_control: FlowControlDto::None,
        auto_reconnect: false,
        rs485_auto_rts: false,
    };

    if let Err(e) = manager.open(req) {
        eprintln!("error: failed to open {port}: {e}");
        return 1;
    }
    eprintln!("Connected to {port} at {baud} baud. Press Ctrl+C to stop.");

    let running = Arc::new(AtomicBool::new(true));
    let running_handler = running.clone();
    if ctrlc::set_handler(move || running_handler.store(false, Ordering::SeqCst)).is_err() {
        eprintln!("warning: could not install Ctrl+C handler");
    }

    let deadline = timeout_secs.map(|s| Instant::now() + Duration::from_secs(s));
    let stdout = io::stdout();
    let mut handle = stdout.lock();
    let mut exit_code = 0;

    while running.load(Ordering::SeqCst) {
        if deadline.is_some_and(|d| Instant::now() >= d) {
            break;
        }

        for (stream_id, bytes) in manager.drain_open_ports() {
            if stream_id != STREAM_ID || bytes.is_empty() {
                continue;
            }
            if handle.write_all(&bytes).is_err() || handle.flush().is_err() {
                // stdout gone (e.g. piped into a process that exited) —
                // nothing more we can usefully do.
                running.store(false, Ordering::SeqCst);
                break;
            }
        }

        // The port can die mid-session (device unplugged) without an open()
        // call ever failing — auto_reconnect is off for this one-shot CLI
        // run, so treat that as fatal rather than spinning on a dead port.
        if let Some((_, PortState::Error { message })) =
            manager.states().into_iter().find(|(id, _)| id == STREAM_ID)
        {
            eprintln!("error: {message}");
            exit_code = 1;
            break;
        }

        std::thread::sleep(POLL_INTERVAL);
    }

    manager.close(STREAM_ID).ok();
    eprintln!("Disconnected.");
    exit_code
}
