//! Patches a small region of a firmware binary with a per-device unique
//! value (serial number / MAC-like key) before flashing — backs STM32
//! Mass Production mode. Writes a patched *copy* to a temp file rather
//! than modifying the source in place, and works on any binary's raw
//! bytes, so it isn't STM32-specific even though that's the only caller
//! today.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionedBinary {
    pub path: String,
    /// The value actually written, formatted for display in a log/report
    /// (decimal digits for `asciiDecimal`, hex for `hexBytes`) — callers
    /// echo this back rather than reformatting the counter themselves.
    pub value_display: String,
}

fn format_value(counter: u64, length: usize, format: &str) -> Result<(Vec<u8>, String), String> {
    match format {
        "asciiDecimal" => {
            let s = format!("{counter:0>length$}");
            if s.len() != length {
                return Err(format!(
                    "counter {counter} needs more than {length} decimal digit(s)"
                ));
            }
            Ok((s.clone().into_bytes(), s))
        }
        "hexBytes" => {
            if length == 0 || length > 8 {
                return Err("hexBytes length must be between 1 and 8 bytes".to_string());
            }
            let full = counter.to_be_bytes();
            let bytes = full[8 - length..].to_vec();
            if counter >> (length * 8).min(63) != 0 && length < 8 {
                return Err(format!("counter {counter} doesn't fit in {length} byte(s)"));
            }
            let hex = bytes.iter().map(|b| format!("{b:02x}")).collect();
            Ok((bytes, hex))
        }
        other => Err(format!("unknown value format {other:?}")),
    }
}

/// Reads `source_path`, overwrites `length` bytes at `offset` with
/// `counter` formatted per `format`, and writes the result to a fresh
/// temp file (never touches the original) — the caller flashes that temp
/// path instead.
pub fn prepare_provisioned_binary(
    source_path: &str,
    offset: u32,
    length: u32,
    format: &str,
    counter: u64,
) -> Result<ProvisionedBinary, String> {
    let mut data =
        fs::read(source_path).map_err(|e| format!("failed to read {source_path}: {e}"))?;
    let offset = offset as usize;
    let length = length as usize;
    let end = offset
        .checked_add(length)
        .ok_or_else(|| "offset + length overflowed".to_string())?;
    if end > data.len() {
        return Err(format!(
            "patch region 0x{offset:x}..0x{end:x} is outside the {} byte file",
            data.len()
        ));
    }

    let (value_bytes, value_display) = format_value(counter, length, format)?;
    data[offset..end].copy_from_slice(&value_bytes);

    let file_name = std::path::Path::new(source_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "provisioned.bin".to_string());
    let mut temp_path: PathBuf = std::env::temp_dir();
    temp_path.push(format!("edt-provision-{counter}-{file_name}"));
    fs::write(&temp_path, data)
        .map_err(|e| format!("failed to write {}: {e}", temp_path.display()))?;

    Ok(ProvisionedBinary {
        path: temp_path.to_string_lossy().to_string(),
        value_display,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_value_ascii_decimal_zero_pads() {
        let (bytes, display) = format_value(42, 8, "asciiDecimal").unwrap();
        assert_eq!(bytes, b"00000042");
        assert_eq!(display, "00000042");
    }

    #[test]
    fn format_value_ascii_decimal_rejects_overflow() {
        assert!(format_value(123_456_789, 4, "asciiDecimal").is_err());
    }

    #[test]
    fn format_value_hex_bytes_big_endian() {
        let (bytes, display) = format_value(0x0102, 4, "hexBytes").unwrap();
        assert_eq!(bytes, vec![0x00, 0x00, 0x01, 0x02]);
        assert_eq!(display, "00000102");
    }

    #[test]
    fn format_value_hex_bytes_rejects_overflow() {
        assert!(format_value(0x1_0000, 2, "hexBytes").is_err());
    }

    #[test]
    fn prepare_provisioned_binary_errors_on_out_of_range_patch() {
        let dir = std::env::temp_dir();
        let path = dir.join("edt-provision-test-input.bin");
        fs::write(&path, vec![0u8; 4]).unwrap();
        let result = prepare_provisioned_binary(path.to_str().unwrap(), 0, 8, "hexBytes", 1);
        assert!(result.is_err());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn prepare_provisioned_binary_patches_and_writes_temp_file() {
        let dir = std::env::temp_dir();
        let path = dir.join("edt-provision-test-input2.bin");
        fs::write(&path, vec![0xffu8; 16]).unwrap();
        let result =
            prepare_provisioned_binary(path.to_str().unwrap(), 4, 4, "asciiDecimal", 7).unwrap();
        let patched = fs::read(&result.path).unwrap();
        assert_eq!(&patched[4..8], b"0007");
        assert_eq!(result.value_display, "0007");
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(&result.path);
    }
}
