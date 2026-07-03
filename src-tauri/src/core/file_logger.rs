//! Log-to-file (M1-T2.7): writes every batch handed to it into two parallel
//! files — a byte-exact raw capture (for replay/reproduction) and a
//! line-oriented capture with an epoch-millisecond timestamp prefix per line
//! (for human review / correlating with other systems) — each rotating
//! independently once it exceeds `max_bytes_per_file`.
//!
//! Deliberately transport-agnostic (only touches `std::fs`), so it can be
//! reused by TCP/UDP/MQTT logging later without changes.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct LogWriterConfig {
    pub directory: PathBuf,
    pub base_name: String,
    pub max_bytes_per_file: u64,
}

impl LogWriterConfig {
    pub fn new(directory: PathBuf, base_name: impl AsRef<str>, max_bytes_per_file: u64) -> Self {
        Self {
            directory,
            base_name: sanitize(base_name.as_ref()),
            max_bytes_per_file,
        }
    }
}

fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn now_epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn open_part(
    dir: &Path,
    base_name: &str,
    session_id: u128,
    kind: &str,
    part: u32,
) -> io::Result<File> {
    let filename = format!("{base_name}_{session_id}.{kind}.{part}.log");
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(filename))
}

pub struct LogWriter {
    config: LogWriterConfig,
    session_id: u128,
    raw_file: File,
    raw_bytes_written: u64,
    raw_part: u32,
    ts_file: File,
    ts_bytes_written: u64,
    ts_part: u32,
    ts_pending: Vec<u8>,
}

impl LogWriter {
    pub fn create(config: LogWriterConfig) -> io::Result<Self> {
        fs::create_dir_all(&config.directory)?;
        let session_id = now_epoch_ms();
        let raw_file = open_part(&config.directory, &config.base_name, session_id, "raw", 1)?;
        let ts_file = open_part(&config.directory, &config.base_name, session_id, "ts", 1)?;
        Ok(Self {
            config,
            session_id,
            raw_file,
            raw_bytes_written: 0,
            raw_part: 1,
            ts_file,
            ts_bytes_written: 0,
            ts_part: 1,
            ts_pending: Vec::new(),
        })
    }

    pub fn write_batch(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.write_raw(bytes)?;
        self.write_timestamped(bytes)
    }

    fn write_raw(&mut self, bytes: &[u8]) -> io::Result<()> {
        if self.raw_bytes_written > 0
            && self.raw_bytes_written + bytes.len() as u64 > self.config.max_bytes_per_file
        {
            self.raw_part += 1;
            self.raw_file = open_part(
                &self.config.directory,
                &self.config.base_name,
                self.session_id,
                "raw",
                self.raw_part,
            )?;
            self.raw_bytes_written = 0;
        }
        self.raw_file.write_all(bytes)?;
        self.raw_bytes_written += bytes.len() as u64;
        Ok(())
    }

    fn write_timestamped(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.ts_pending.extend_from_slice(bytes);

        let mut line_end_positions = Vec::new();
        for (i, &b) in self.ts_pending.iter().enumerate() {
            if b == b'\n' {
                line_end_positions.push(i);
            }
        }
        if line_end_positions.is_empty() {
            return Ok(());
        }

        let mut consumed_upto = 0;
        for end in line_end_positions {
            let line = &self.ts_pending[consumed_upto..=end];
            let prefixed = format!("[{}] ", now_epoch_ms());
            let entry_len = prefixed.len() as u64 + line.len() as u64;

            if self.ts_bytes_written > 0
                && self.ts_bytes_written + entry_len > self.config.max_bytes_per_file
            {
                self.ts_part += 1;
                self.ts_file = open_part(
                    &self.config.directory,
                    &self.config.base_name,
                    self.session_id,
                    "ts",
                    self.ts_part,
                )?;
                self.ts_bytes_written = 0;
            }
            self.ts_file.write_all(prefixed.as_bytes())?;
            self.ts_file.write_all(line)?;
            self.ts_bytes_written += entry_len;
            consumed_upto = end + 1;
        }
        self.ts_pending.drain(..consumed_upto);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("edt-file-logger-test-{name}-{}", now_epoch_ms()));
        dir
    }

    #[test]
    fn writes_raw_bytes_exactly() {
        let dir = temp_dir("raw");
        let mut writer =
            LogWriter::create(LogWriterConfig::new(dir.clone(), "com5", 1 << 20)).unwrap();
        writer.write_batch(b"hello\nworld\n").unwrap();
        let raw_content =
            fs::read(dir.join(format!("com5_{}.raw.1.log", writer.session_id))).unwrap();
        assert_eq!(raw_content, b"hello\nworld\n");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn timestamped_file_prefixes_each_complete_line() {
        let dir = temp_dir("ts");
        let mut writer =
            LogWriter::create(LogWriterConfig::new(dir.clone(), "com5", 1 << 20)).unwrap();
        writer.write_batch(b"hello\nworld\n").unwrap();
        let ts_content =
            fs::read_to_string(dir.join(format!("com5_{}.ts.1.log", writer.session_id))).unwrap();
        let lines: Vec<&str> = ts_content.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with('[') && lines[0].ends_with("] hello"));
        assert!(lines[1].ends_with("] world"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn partial_line_stays_pending_until_newline_arrives() {
        let dir = temp_dir("partial");
        let mut writer =
            LogWriter::create(LogWriterConfig::new(dir.clone(), "com5", 1 << 20)).unwrap();
        writer.write_batch(b"hel").unwrap();
        writer.write_batch(b"lo\n").unwrap();
        let ts_content =
            fs::read_to_string(dir.join(format!("com5_{}.ts.1.log", writer.session_id))).unwrap();
        assert!(ts_content.trim_end().ends_with("] hello"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sanitize_replaces_unsafe_filename_characters() {
        assert_eq!(sanitize("COM5/../weird name"), "COM5____weird_name");
    }
}
