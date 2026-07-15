//! Best-effort ESP32 core-dump decoder. On a panic with
//! `CONFIG_ESP_COREDUMP_ENABLE_TO_UART`, the device prints a base64 blob
//! between `CORE DUMP START`/`END` markers; this extracts and base64-decodes
//! it, identifies the format (ELF vs the legacy binary layout), and scans
//! for 32-bit values that fall in the ESP32 code-address range — candidate
//! return addresses, resolved to function/file:line by the caller via the
//! app `.elf`'s DWARF info (see `elf_analysis::decode_addresses`).
//!
//! This is deliberately a *heuristic* address scan, the same spirit as
//! `backtrace.rs`'s bare-hex fallback, not a full core-dump unwinder: it
//! doesn't parse the ELF note segments for the exact per-task register set,
//! so the resolved list is a superset (the real frames plus some noise) —
//! but the ones that resolve to real function names are what matter, and
//! this works across both core-dump formats without chip-specific unwinding.
//!
//! NOTE: written without a real device core dump to validate against — the
//! extraction/format-detection/scan logic is unit-tested, but the practical
//! usefulness of the resolved frames should be confirmed on a real crash.

use serde::Serialize;

/// ESP32 code lives high in the address space: Xtensa IRAM/IROM around
/// 0x4000_0000–0x4280_0000 and RISC-V (C3/C6) flash/IRAM in a similar band.
/// A broad window catches return addresses for either without much noise,
/// since RAM data addresses (0x3F..–0x3FF..) fall well below it.
const CODE_ADDR_MIN: u32 = 0x4000_0000;
const CODE_ADDR_MAX: u32 = 0x4300_0000;

// Cap the candidate list — a whole stack can contain many in-range values,
// but the useful backtrace is short and the caller resolves each one.
const MAX_CANDIDATES: usize = 64;

const START_MARKER: &str = "CORE DUMP START";
const END_MARKER: &str = "CORE DUMP END";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreDumpScan {
    /// "elf", "legacy", or "unknown" — informational, based on a magic check.
    pub format: String,
    pub size_bytes: usize,
    pub candidate_addresses: Vec<u64>,
}

/// Pulls the base64 payload out of pasted UART output. Uses the region
/// between the START/END markers when present; otherwise treats the whole
/// input as the blob (the user may have copied just the base64).
fn extract_base64(text: &str) -> String {
    let body = match (text.find(START_MARKER), text.find(END_MARKER)) {
        (Some(start), Some(end)) if end > start => {
            // Content begins after the START marker's own line...
            let content_start = text[start..end]
                .find('\n')
                .map(|nl| start + nl + 1)
                .unwrap_or(end);
            // ...and ends at the newline before the END marker's line, so the
            // `====` framing on that line isn't captured as stray padding.
            let content_end = text[content_start..end]
                .rfind('\n')
                .map(|nl| content_start + nl)
                .unwrap_or(end);
            &text[content_start..content_end]
        }
        _ => text,
    };
    body.chars().filter(|c| !c.is_whitespace()).collect()
}

fn b64_value(c: u8) -> Option<u8> {
    match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// Standard-alphabet base64 decode. Padding (`=`) and any stray non-alphabet
/// characters are ignored, so it tolerates the messy copy/paste this tends
/// to get.
fn decode_base64(s: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits = 0;
    for &c in s.as_bytes() {
        let Some(v) = b64_value(c) else { continue };
        acc = (acc << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    if out.is_empty() {
        return Err("no base64 data found".to_string());
    }
    Ok(out)
}

fn detect_format(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x7f, b'E', b'L', b'F']) {
        "elf"
    } else if bytes.len() >= 4 {
        // The legacy binary core dump begins with a little-endian total-size
        // word; there's no reliable magic, so anything non-ELF with a
        // plausible body is reported as "legacy".
        "legacy"
    } else {
        "unknown"
    }
}

/// Scans the decoded bytes for 4-byte-aligned little-endian words in the
/// code-address range — candidate return addresses. Deduped, order
/// preserved (roughly stack order), capped.
fn scan_addresses(bytes: &[u8]) -> Vec<u64> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 4 <= bytes.len() {
        let word = u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
        if (CODE_ADDR_MIN..CODE_ADDR_MAX).contains(&word) && seen.insert(word) {
            out.push(u64::from(word));
            if out.len() >= MAX_CANDIDATES {
                break;
            }
        }
        i += 4;
    }
    out
}

pub fn analyze_core_dump(text: &str) -> Result<CoreDumpScan, String> {
    let base64 = extract_base64(text);
    let bytes = decode_base64(&base64)?;
    Ok(CoreDumpScan {
        format: detect_format(&bytes).to_string(),
        size_bytes: bytes.len(),
        candidate_addresses: scan_addresses(&bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_base64_roundtrips_known_value() {
        // "Man" -> "TWFu"
        assert_eq!(decode_base64("TWFu").unwrap(), b"Man");
        // with padding and whitespace
        assert_eq!(decode_base64("TWE =").unwrap(), b"Ma");
    }

    #[test]
    fn extract_base64_uses_marker_region() {
        let text = "junk\n================= CORE DUMP START =================\nTWFu\n================= CORE DUMP END =================\nmore junk";
        assert_eq!(extract_base64(text), "TWFu");
    }

    #[test]
    fn extract_base64_falls_back_to_whole_input() {
        assert_eq!(extract_base64("TW\nFu"), "TWFu");
    }

    #[test]
    fn detect_format_recognizes_elf_magic() {
        assert_eq!(detect_format(&[0x7f, b'E', b'L', b'F', 1, 2]), "elf");
        assert_eq!(detect_format(&[0x01, 0x00, 0x00, 0x00]), "legacy");
        assert_eq!(detect_format(&[0x01]), "unknown");
    }

    #[test]
    fn scan_finds_in_range_addresses_and_dedupes() {
        // Two code addresses (0x400d1234 twice, 0x40080abc once) plus a RAM
        // pointer (0x3ffb0000) that must be ignored.
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0x400d_1234u32.to_le_bytes());
        bytes.extend_from_slice(&0x3ffb_0000u32.to_le_bytes());
        bytes.extend_from_slice(&0x4008_0abcu32.to_le_bytes());
        bytes.extend_from_slice(&0x400d_1234u32.to_le_bytes());
        let addrs = scan_addresses(&bytes);
        assert_eq!(addrs, vec![0x400d_1234, 0x4008_0abc]);
    }

    #[test]
    fn analyze_reports_format_and_addresses() {
        // base64 of ELF magic + one code address (0x400d1234 LE)
        let mut raw = vec![0x7f, b'E', b'L', b'F'];
        raw.extend_from_slice(&0x400d_1234u32.to_le_bytes());
        let b64 = base64_encode(&raw);
        let scan = analyze_core_dump(&b64).unwrap();
        assert_eq!(scan.format, "elf");
        assert_eq!(scan.size_bytes, 8);
        assert_eq!(scan.candidate_addresses, vec![0x400d_1234]);
    }

    // Tiny standard-alphabet encoder, test-only, to build fixtures.
    fn base64_encode(bytes: &[u8]) -> String {
        const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
            out.push(A[(n >> 18 & 63) as usize] as char);
            out.push(A[(n >> 12 & 63) as usize] as char);
            out.push(if chunk.len() > 1 {
                A[(n >> 6 & 63) as usize] as char
            } else {
                '='
            });
            out.push(if chunk.len() > 2 {
                A[(n & 63) as usize] as char
            } else {
                '='
            });
        }
        out
    }
}
