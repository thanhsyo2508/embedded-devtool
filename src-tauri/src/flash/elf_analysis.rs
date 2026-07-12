//! Reads a build's `.elf` file directly (DWARF debug info + section
//! headers) for two things esptool/STM32CubeProgrammer don't offer:
//! decoding a crash backtrace's raw addresses into function/file/line, and
//! breaking down flash/RAM usage by section. Pure Rust (`object` +
//! `addr2line`) — no bundled toolchain binary (e.g.
//! `xtensa-esp32-elf-addr2line`) needs to be shipped or found on PATH, and
//! it works the same for Xtensa or RISC-V ESP32 variants, or STM32/ARM,
//! since DWARF and ELF section headers aren't architecture-specific.

use std::fs;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedFrame {
    pub address: u64,
    pub function: Option<String>,
    pub file: Option<String>,
    pub line: Option<u32>,
}

/// Resolves each address to a function name + file:line using the ELF's
/// DWARF debug info — the addresses come from a pasted crash backtrace
/// (see `flash::backtrace::parse_addresses`), this just answers "what was
/// at each one". An address with no debug info still comes back (fields
/// `None`) rather than erroring, since a partial decode is still useful
/// (e.g. addresses inside a stripped third-party library).
pub fn decode_addresses(elf_path: &str, addresses: &[u64]) -> Result<Vec<DecodedFrame>, String> {
    let loader =
        addr2line::Loader::new(elf_path).map_err(|e| format!("failed to load {elf_path}: {e}"))?;

    Ok(addresses
        .iter()
        .map(|&address| {
            let mut function = None;
            let mut file = None;
            let mut line = None;
            if let Ok(mut frames) = loader.find_frames(address) {
                if let Ok(Some(frame)) = frames.next() {
                    if let Some(name) = &frame.function {
                        function = name.demangle().ok().map(|c| c.into_owned());
                    }
                    if let Some(loc) = &frame.location {
                        file = loc.file.map(|f| f.to_string());
                        line = loc.line;
                    }
                }
            }
            DecodedFrame {
                address,
                function,
                file,
                line,
            }
        })
        .collect())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionInfo {
    pub name: String,
    pub address: u64,
    pub size: u64,
    /// One of "text" | "data" | "rodata" | "bss" | "other" — classified
    /// from the ELF section header's type/flags (SHT_NOBITS, SHF_EXECINSTR,
    /// ...), not the section's name, so this stays accurate even for
    /// ESP-IDF's non-standard names (`.iram0.text`, `.dram0.bss`, ...).
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryMap {
    pub sections: Vec<SectionInfo>,
    /// Sum of every section that occupies space in the flashed binary
    /// (text/rodata/data) — excludes `.bss`, which is zero-initialized at
    /// boot and never written to flash.
    pub flash_bytes: u64,
    /// Sum of every section resident in RAM at runtime (data + bss).
    pub ram_bytes: u64,
}

pub fn parse_memory_map(elf_path: &str) -> Result<MemoryMap, String> {
    use object::{Object, ObjectSection, SectionKind};

    let data = fs::read(elf_path).map_err(|e| format!("failed to read {elf_path}: {e}"))?;
    let file = object::File::parse(&*data).map_err(|e| format!("not a valid ELF file: {e}"))?;

    let mut sections = Vec::new();
    let mut flash_bytes = 0u64;
    let mut ram_bytes = 0u64;

    for section in file.sections() {
        let size = section.size();
        if size == 0 {
            continue;
        }
        let name = section.name().unwrap_or("?").to_string();
        let kind = match section.kind() {
            SectionKind::Text => "text",
            SectionKind::Data => "data",
            SectionKind::ReadOnlyData | SectionKind::ReadOnlyString => "rodata",
            SectionKind::UninitializedData => "bss",
            _ => "other",
        };

        match kind {
            "text" | "rodata" => flash_bytes += size,
            "data" => {
                flash_bytes += size;
                ram_bytes += size;
            }
            "bss" => ram_bytes += size,
            _ => {}
        }

        sections.push(SectionInfo {
            name,
            address: section.address(),
            size,
            kind: kind.to_string(),
        });
    }

    sections.sort_by_key(|s| std::cmp::Reverse(s.size));

    Ok(MemoryMap {
        sections,
        flash_bytes,
        ram_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_memory_map_errors_on_missing_file() {
        assert!(parse_memory_map("no-such-file.elf").is_err());
    }

    #[test]
    fn decode_addresses_errors_on_missing_file() {
        assert!(decode_addresses("no-such-file.elf", &[0x400d1234]).is_err());
    }
}
