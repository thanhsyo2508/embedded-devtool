//! Enumerates global/static variables from a build's `.elf` DWARF debug
//! info — used by the SWD variable watch feature (see `core::rtt_stream`)
//! to let a user watch a variable by name instead of typing a raw address.
//!
//! Only *global/static* variables are listed: their location is a fixed
//! `DW_OP_addr <address>` expression, readable over SWD while the target
//! runs freely. Local (stack/register) variables need the core halted at a
//! breakpoint to resolve — out of scope here, see the eSTM32 SWD debug
//! discussion this module was built for.
//!
//! Pure Rust (`object` + `gimli`, the same crates `flash::elf_analysis`
//! already uses via `addr2line`) — `gimli` is used directly here since
//! `addr2line::Loader` only exposes address→location lookups, not a way to
//! walk arbitrary DIEs for variable declarations.

use std::borrow::Cow;

use gimli::{AttributeValue, EndianSlice, Reader, RunTimeEndian, Unit};
use object::{Object, ObjectSection};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableInfo {
    pub name: String,
    pub address: u64,
    pub size: u32,
    /// One of "bool" | "u8"/"u16"/"u32"/"u64" | "i8"/"i16"/"i32"/"i64" |
    /// "f32"/"f64" | "bytes" — "bytes" for anything not a recognized
    /// primitive (struct, array, pointer, enum...), which the frontend
    /// shows as raw hex instead of trying to decode a numeric value.
    pub type_hint: String,
}

fn load_section<'a>(
    object: &object::File<'a>,
    id: gimli::SectionId,
) -> EndianSlice<'a, RunTimeEndian> {
    let endian = if object.is_little_endian() {
        RunTimeEndian::Little
    } else {
        RunTimeEndian::Big
    };
    let data: &'a [u8] = match object.section_by_name(id.name()) {
        Some(section) => match section.uncompressed_data().unwrap_or(Cow::Borrowed(&[])) {
            Cow::Borrowed(b) => b,
            // Compressed debug sections are rare for embedded builds —
            // leaking the decompressed bytes for the process's lifetime is
            // simpler than an arena for a function that runs once per
            // "list variables" click, and the leak is small in practice.
            Cow::Owned(b) => Box::leak(b.into_boxed_slice()),
        },
        None => &[],
    };
    EndianSlice::new(data, endian)
}

/// A plain `DW_OP_addr <address>` expression — the only location form a
/// global/static variable can have. Anything else (register-relative,
/// thread-local, optimized away) is skipped rather than guessed at.
fn static_address<R: Reader>(value: AttributeValue<R>, address_size: u8) -> Option<u64> {
    let AttributeValue::Exprloc(expr) = value else {
        return None;
    };
    let bytes = expr.0.to_slice().ok()?;
    if bytes.first() != Some(&0x03) {
        return None;
    }
    let addr_bytes = bytes.get(1..1 + address_size as usize)?;
    let mut buf = [0u8; 8];
    buf[..addr_bytes.len()].copy_from_slice(addr_bytes);
    Some(u64::from_le_bytes(buf))
}

/// DWARF base-type encodings (DW_ATE_*) — stable values from the DWARF
/// spec, not worth pulling in `gimli::constants::DwAte` comparisons for.
fn base_type_hint(encoding: Option<u64>, byte_size: u32) -> String {
    match encoding {
        Some(0x02) => "bool".to_string(),
        Some(0x04) => (if byte_size == 8 { "f64" } else { "f32" }).to_string(),
        Some(0x05) | Some(0x06) => format!("i{}", byte_size * 8),
        Some(0x07) | Some(0x08) => format!("u{}", byte_size * 8),
        _ => "bytes".to_string(),
    }
}

/// Follows `DW_AT_type` through `const`/`volatile`/`typedef` wrappers to
/// the underlying base type, if any — falls back to `"bytes"` (with
/// whatever `DW_AT_byte_size` is available) for structs, arrays, pointers,
/// and anything else that isn't a single scalar.
fn resolve_type<R: Reader>(unit: &Unit<R>, mut value: AttributeValue<R>) -> Option<(u32, String)> {
    for _ in 0..8 {
        let AttributeValue::UnitRef(offset) = value else {
            return None;
        };
        let entry = unit.entry(offset).ok()?;
        match entry.tag() {
            gimli::DW_TAG_base_type => {
                let byte_size = entry.attr_value(gimli::DW_AT_byte_size)?.udata_value()? as u32;
                let encoding = entry
                    .attr_value(gimli::DW_AT_encoding)
                    .and_then(|v| v.udata_value());
                return Some((byte_size, base_type_hint(encoding, byte_size)));
            }
            gimli::DW_TAG_const_type | gimli::DW_TAG_volatile_type | gimli::DW_TAG_typedef => {
                value = entry.attr_value(gimli::DW_AT_type)?;
            }
            _ => {
                let byte_size = entry
                    .attr_value(gimli::DW_AT_byte_size)
                    .and_then(|v| v.udata_value())?;
                return Some((byte_size as u32, "bytes".to_string()));
            }
        }
    }
    None
}

/// Lists every global/static variable declared in `elf_path`'s DWARF info.
pub fn list_variables(elf_path: &str) -> Result<Vec<VariableInfo>, String> {
    let data = std::fs::read(elf_path).map_err(|e| format!("failed to read {elf_path}: {e}"))?;
    let object = object::File::parse(&*data).map_err(|e| format!("not a valid ELF file: {e}"))?;

    let dwarf =
        gimli::Dwarf::load(|id| -> Result<_, gimli::Error> { Ok(load_section(&object, id)) })
            .map_err(|e| e.to_string())?;

    let mut variables = Vec::new();
    let mut units = dwarf.units();
    while let Some(header) = units.next().map_err(|e| e.to_string())? {
        let unit = match dwarf.unit(header) {
            Ok(u) => u,
            Err(_) => continue,
        };
        let address_size = unit.header.address_size();
        let mut entries = unit.entries();
        while let Some(entry) = entries.next_dfs().map_err(|e| e.to_string())? {
            if entry.depth() != 1 || entry.tag() != gimli::DW_TAG_variable {
                continue;
            }
            let Some(name) = entry
                .attr_value(gimli::DW_AT_name)
                .and_then(|v| dwarf.attr_string(&unit, v).ok())
                .map(|r| r.to_string_lossy().into_owned())
            else {
                continue;
            };
            let Some(address) = entry
                .attr_value(gimli::DW_AT_location)
                .and_then(|v| static_address(v, address_size))
            else {
                continue;
            };
            let (size, type_hint) = entry
                .attr_value(gimli::DW_AT_type)
                .and_then(|v| resolve_type(&unit, v))
                .unwrap_or((address_size as u32, "bytes".to_string()));
            variables.push(VariableInfo {
                name,
                address,
                size,
                type_hint,
            });
        }
    }

    variables.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(variables)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_variables_errors_on_missing_file() {
        assert!(list_variables("no-such-file.elf").is_err());
    }
}
