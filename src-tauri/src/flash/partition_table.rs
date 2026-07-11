//! Parses a compiled ESP-IDF partition table binary (`partitions.bin` /
//! `partition-table.bin`, produced by Arduino/PlatformIO/ESP-IDF builds
//! alike) into its entries. This is the authoritative source for where each
//! partition (app, spiffs/littlefs/fat, otadata, nvs, ...) actually lives —
//! offsets shift with flash size and partition scheme, so the Flash panel's
//! "Smart add" trusts this over filename convention rather than ever
//! guessing an offset for a filesystem image.

use serde::Serialize;

const ENTRY_SIZE: usize = 32;
const ENTRY_MAGIC: [u8; 2] = [0xaa, 0x50];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartitionEntry {
    pub label: String,
    pub part_type: u8,
    pub subtype: u8,
    pub offset: u32,
    pub size: u32,
}

/// Each entry is a fixed 32 bytes: magic(2) + type(1) + subtype(1) +
/// offset(4, LE) + size(4, LE) + label(16, null-padded ASCII) + flags(4,
/// LE). The table ends at the first entry whose magic doesn't match —
/// either 0xFFFF padding or an 0xEBEB MD5-checksum entry appended by newer
/// `gen_esp32part.py` versions, neither of which is a real partition.
pub fn parse_partition_table(bytes: &[u8]) -> Result<Vec<PartitionEntry>, String> {
    let mut entries = Vec::new();
    let mut pos = 0;
    while pos + ENTRY_SIZE <= bytes.len() {
        let chunk = &bytes[pos..pos + ENTRY_SIZE];
        pos += ENTRY_SIZE;
        if chunk[0..2] != ENTRY_MAGIC {
            break;
        }
        let part_type = chunk[2];
        let subtype = chunk[3];
        let offset = u32::from_le_bytes([chunk[4], chunk[5], chunk[6], chunk[7]]);
        let size = u32::from_le_bytes([chunk[8], chunk[9], chunk[10], chunk[11]]);
        let label_bytes = &chunk[12..28];
        let label_end = label_bytes
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(label_bytes.len());
        let label = String::from_utf8_lossy(&label_bytes[..label_end]).to_string();
        entries.push(PartitionEntry {
            label,
            part_type,
            subtype,
            offset,
            size,
        });
    }
    if entries.is_empty() {
        return Err(
            "no valid partition entries found — not a compiled ESP-IDF partition table?"
                .to_string(),
        );
    }
    Ok(entries)
}

pub fn parse_partition_table_file(path: &str) -> Result<Vec<PartitionEntry>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("failed to read {path}: {e}"))?;
    parse_partition_table(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry_bytes(part_type: u8, subtype: u8, offset: u32, size: u32, label: &str) -> [u8; 32] {
        let mut buf = [0u8; 32];
        buf[0..2].copy_from_slice(&ENTRY_MAGIC);
        buf[2] = part_type;
        buf[3] = subtype;
        buf[4..8].copy_from_slice(&offset.to_le_bytes());
        buf[8..12].copy_from_slice(&size.to_le_bytes());
        let label_bytes = label.as_bytes();
        buf[12..12 + label_bytes.len()].copy_from_slice(label_bytes);
        buf
    }

    #[test]
    fn parses_app_and_data_entries_and_stops_at_padding() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&entry_bytes(0x00, 0x00, 0x10000, 0x100000, "factory"));
        bytes.extend_from_slice(&entry_bytes(0x01, 0x82, 0x290000, 0x160000, "spiffs"));
        bytes.extend_from_slice(&[0xff; ENTRY_SIZE]); // end-of-table padding

        let entries = parse_partition_table(&bytes).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].label, "factory");
        assert_eq!(entries[0].offset, 0x10000);
        assert_eq!(entries[0].size, 0x100000);
        assert_eq!(entries[1].label, "spiffs");
        assert_eq!(entries[1].subtype, 0x82);
    }

    #[test]
    fn stops_at_md5_checksum_entry() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&entry_bytes(0x01, 0x02, 0x9000, 0x5000, "nvs"));
        let mut md5_entry = [0u8; 32];
        md5_entry[0..2].copy_from_slice(&[0xeb, 0xeb]);
        bytes.extend_from_slice(&md5_entry);

        let entries = parse_partition_table(&bytes).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].label, "nvs");
    }

    #[test]
    fn errors_on_garbage_input() {
        let err = parse_partition_table(&[0u8; 64]).unwrap_err();
        assert!(err.contains("no valid partition entries"));
    }

    #[test]
    fn label_without_trailing_null_padding_is_read_in_full() {
        // A 16-byte label with no room for a null terminator (max length) —
        // must not panic and must read all 16 bytes.
        let bytes = entry_bytes(0x00, 0x10, 0x110000, 0x100000, "exactly16chars!!");
        let entries = parse_partition_table(&bytes).unwrap();
        assert_eq!(entries[0].label, "exactly16chars!!");
    }
}
