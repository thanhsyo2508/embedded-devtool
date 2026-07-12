//! Extracts code addresses worth decoding out of pasted crash output —
//! kept separate from `elf_analysis` (which only knows how to resolve an
//! address, not where addresses come from in raw device output).

use regex::Regex;

/// Parses ESP-IDF/Arduino-ESP32 style crash backtraces: one or more
/// "Backtrace:" lines made of `PC:SP` pairs (`0x400d1e2d:0x3ffb9f30 ...`).
/// Only the PC (first value of each pair) is a code address worth
/// resolving — the SP would decode to nonsense. Falls back to every
/// 0x-prefixed hex token in the input if no `PC:SP` pair is found, so a
/// user can also paste a bare list of addresses (e.g. from a register dump).
pub fn parse_addresses(text: &str) -> Vec<u64> {
    let pair_re = Regex::new(r"0x([0-9a-fA-F]{8}):0x[0-9a-fA-F]{8}").unwrap();
    let mut addresses: Vec<u64> = pair_re
        .captures_iter(text)
        .filter_map(|c| u64::from_str_radix(&c[1], 16).ok())
        .collect();

    if addresses.is_empty() {
        let bare_re = Regex::new(r"0x([0-9a-fA-F]{6,8})\b").unwrap();
        addresses = bare_re
            .captures_iter(text)
            .filter_map(|c| u64::from_str_radix(&c[1], 16).ok())
            .collect();
    }
    addresses
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pc_sp_pairs_from_backtrace_line() {
        let text = "Backtrace: 0x400d1e2d:0x3ffb9f30 0x400d1e97:0x3ffb9f50";
        assert_eq!(parse_addresses(text), vec![0x400d1e2d, 0x400d1e97]);
    }

    #[test]
    fn falls_back_to_bare_hex_tokens() {
        let text = "PC : 0x400d1234  EXCVADDR: 0x00000000";
        assert_eq!(parse_addresses(text), vec![0x400d1234, 0x0]);
    }

    #[test]
    fn empty_input_yields_no_addresses() {
        assert!(parse_addresses("nothing here").is_empty());
    }
}
