//! STM32 flashing (M2-T2), wrapping the external `STM32_Programmer_CLI`.
//!
//! Unlike ESP32 (a pure Rust library), ST's tool is proprietary and cannot
//! be bundled with this app — its license does not permit redistribution.
//! This module only *detects* an existing install and shells out to it, per
//! the risk mitigation already recorded in the project plan.
//!
//! CLI output format is not covered by any stability guarantee from ST and
//! has changed across versions, so parsing here is deliberately best-effort:
//! the **process exit code is the only authoritative success signal**; the
//! regexes below only extract nice-to-have progress/device info and quietly
//! return `None` on anything they don't recognize rather than failing.
//!
//! NOTE: written without STM32CubeProgrammer installed in the dev
//! environment — the exact CLI flags follow ST's documented conventions but
//! have not been exercised against a real install or device. Treat the
//! first real run as the actual test of this module.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use regex::Regex;
use serde::{Deserialize, Serialize};

#[cfg(windows)]
const CLI_EXE_NAME: &str = "STM32_Programmer_CLI.exe";
#[cfg(not(windows))]
const CLI_EXE_NAME: &str = "STM32_Programmer_CLI";

#[cfg(windows)]
const DEFAULT_INSTALL_DIRS: &[&str] = &[
    r"C:\Program Files\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin",
    r"C:\Program Files (x86)\STMicroelectronics\STM32Cube\STM32CubeProgrammer\bin",
];
#[cfg(target_os = "macos")]
const DEFAULT_INSTALL_DIRS: &[&str] =
    &["/Applications/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin"];
#[cfg(all(unix, not(target_os = "macos")))]
const DEFAULT_INSTALL_DIRS: &[&str] =
    &["/usr/local/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin"];

/// M2-T2.1: looks for the CLI on PATH first, then well-known default
/// install locations. Returns `None` (never an error) if not found — the UI
/// is expected to show a "download STM32CubeProgrammer" prompt in that case.
pub fn find_cli() -> Option<PathBuf> {
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(CLI_EXE_NAME);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    for dir in DEFAULT_INSTALL_DIRS {
        let candidate = Path::new(dir).join(CLI_EXE_NAME);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    if let Some(home) = dirs_home() {
        let candidate = home
            .join("STM32CubeProgrammer")
            .join("bin")
            .join(CLI_EXE_NAME);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

fn dirs_home() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Interface {
    /// Flash via an ST-Link debug probe (SWD).
    SwLink,
    /// Flash via the built-in UART bootloader (BOOT0 must be set to enter it).
    Uart { port: String, baud: u32 },
}

impl Interface {
    fn connect_arg(&self) -> String {
        match self {
            Interface::SwLink => "port=SWD".to_string(),
            Interface::Uart { port, baud } => format!("port={port} baudrate={baud}"),
        }
    }
}

/// Runs the CLI with the given args, streaming each output line (stdout and
/// stderr interleaved, in the order the process produced them as best as
/// two separate reader threads can preserve) to `on_line`. Returns whether
/// the process exited successfully — this, not the output text, is the
/// authoritative result.
fn run_cli(cli: &Path, args: &[String], mut on_line: impl FnMut(&str)) -> Result<bool, String> {
    let mut child = Command::new(cli)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to launch {}: {e}", cli.display()))?;

    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");

    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let tx_err = tx.clone();
    let stdout_thread = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = tx.send(line);
        }
    });
    let stderr_thread = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = tx_err.send(line);
        }
    });

    // Drop our own sender copies so `rx` closes once both reader threads finish.
    drop(stdout_thread);

    for line in rx {
        on_line(&line);
    }
    let _ = stderr_thread.join();

    let status = child.wait().map_err(|e| e.to_string())?;
    Ok(status.success())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McuInfo {
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    pub raw_output: String,
}

fn extract_field(lines: &[String], label_pattern: &str) -> Option<String> {
    let re = Regex::new(&format!(r"(?i){label_pattern}\s*[:=]\s*(.+)")).ok()?;
    lines.iter().find_map(|line| {
        re.captures(line)
            .map(|c| c[1].trim().trim_end_matches('\r').to_string())
    })
}

/// M2-T2.5: connects without flashing and parses `Device ID`/`Device name`
/// out of the connect banner. Returns `None` fields (not an error) if the
/// installed CLI version labels these differently — `raw_output` always
/// carries the full log so the UI can show it either way.
pub fn detect_mcu(cli: &Path, interface: &Interface) -> Result<McuInfo, String> {
    let args = vec!["-c".to_string(), interface.connect_arg()];
    let mut lines = Vec::new();
    let success = run_cli(cli, &args, |line| lines.push(line.to_string()))?;
    if !success {
        return Err(lines.join("\n"));
    }
    Ok(McuInfo {
        device_id: extract_field(&lines, "Device ID"),
        device_name: extract_field(&lines, "Device name"),
        raw_output: lines.join("\n"),
    })
}

/// M2-T2.3/T2.4: flashes `file_path` at `address` (e.g. "0x08000000") over
/// either interface. `verify`/`reset` map to the CLI's `-v`/`-rst` flags.
pub fn flash_binary(
    cli: &Path,
    interface: &Interface,
    file_path: &str,
    address: &str,
    verify: bool,
    reset: bool,
    mut on_line: impl FnMut(&str),
) -> Result<(), String> {
    let mut args = vec![
        "-c".to_string(),
        interface.connect_arg(),
        "-w".to_string(),
        file_path.to_string(),
        address.to_string(),
    ];
    if verify {
        args.push("-v".to_string());
    }
    if reset {
        args.push("-rst".to_string());
    }

    let mut lines = Vec::new();
    let success = run_cli(cli, &args, |line| {
        on_line(line);
        lines.push(line.to_string());
    })?;

    if success {
        Ok(())
    } else {
        Err(lines.join("\n"))
    }
}

/// M2-T2.7: mass erase (`-e all`).
pub fn mass_erase(
    cli: &Path,
    interface: &Interface,
    mut on_line: impl FnMut(&str),
) -> Result<(), String> {
    let args = vec![
        "-c".to_string(),
        interface.connect_arg(),
        "-e".to_string(),
        "all".to_string(),
    ];
    let mut lines = Vec::new();
    let success = run_cli(cli, &args, |line| {
        on_line(line);
        lines.push(line.to_string());
    })?;
    if success {
        Ok(())
    } else {
        Err(lines.join("\n"))
    }
}

/// M2-T2.8: dumps option bytes as raw CLI text (`-ob displ`) — parsing the
/// exact bit layout varies too much by STM32 family to model generically,
/// so this surfaces ST's own display rather than a half-correct decode.
pub fn read_option_bytes(cli: &Path, interface: &Interface) -> Result<String, String> {
    let args = vec![
        "-c".to_string(),
        interface.connect_arg(),
        "-ob".to_string(),
        "displ".to_string(),
    ];
    let mut lines = Vec::new();
    let success = run_cli(cli, &args, |line| lines.push(line.to_string()))?;
    let output = lines.join("\n");
    if success {
        Ok(output)
    } else {
        Err(output)
    }
}

/// M2-T2.8: writes one option byte field, e.g. `name="RDP"`, `value="0xBB"`.
/// The RDP confirmation warning is enforced at the UI layer (two-step
/// confirm) — this function performs the write as instructed with no
/// additional guardrails, since the backend has no reliable way to know
/// which option byte names are destructive across every STM32 family.
pub fn write_option_byte(
    cli: &Path,
    interface: &Interface,
    name: &str,
    value: &str,
    mut on_line: impl FnMut(&str),
) -> Result<(), String> {
    let args = vec![
        "-c".to_string(),
        interface.connect_arg(),
        "-ob".to_string(),
        format!("{name}={value}"),
    ];
    let mut lines = Vec::new();
    let success = run_cli(cli, &args, |line| {
        on_line(line);
        lines.push(line.to_string());
    })?;
    if success {
        Ok(())
    } else {
        Err(lines.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_field_is_case_insensitive_and_trims() {
        let lines = vec![
            "Device ID  : 0x415".to_string(),
            "Device name : STM32F4xx".to_string(),
        ];
        assert_eq!(extract_field(&lines, "device id").as_deref(), Some("0x415"));
        assert_eq!(
            extract_field(&lines, "Device Name").as_deref(),
            Some("STM32F4xx")
        );
    }

    #[test]
    fn extract_field_returns_none_on_unrecognized_format() {
        let lines = vec!["Some totally different CLI output".to_string()];
        assert_eq!(extract_field(&lines, "Device ID"), None);
    }

    #[test]
    fn swd_connect_arg() {
        assert_eq!(Interface::SwLink.connect_arg(), "port=SWD");
    }

    #[test]
    fn uart_connect_arg() {
        let iface = Interface::Uart {
            port: "COM5".to_string(),
            baud: 115_200,
        };
        assert_eq!(iface.connect_arg(), "port=COM5 baudrate=115200");
    }
}
