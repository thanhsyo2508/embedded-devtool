//! ESP32 eFuse-based security features: read a curated summary of
//! security-relevant eFuses, and burn a single named field, using
//! espflash's own per-chip field definitions and its tested eFuse
//! read/write primitives — no Python/espefuse.py dependency, keeping the
//! same pure-Rust design as the rest of ESP32 flashing.
//!
//! Only a hand-picked list of security-relevant fields is exposed (flash
//! encryption / secure boot / JTAG / UART-download counters and enable
//! bits) rather than every eFuse — burning an arbitrary eFuse bit can
//! corrupt unrelated calibration data or brick the chip, and unlike
//! STM32's vendor CLI there is no second layer of validation here to catch
//! a mistake, so the burnable set is deliberately small and named.
//!
//! Burning flash encryption or secure boot *fully* (including generating
//! and burning the AES/RSA key material) is a much larger, chip-family-
//! specific workflow than a single eFuse bit — this module only exposes
//! the individual enable-bit/counter fields verbatim. The UI requires a
//! typed confirmation before every burn and links to Espressif's official
//! docs for the complete procedure.

use espflash::target::efuse::{self, EfuseField};
use espflash::target::Chip;
use serde::Serialize;

use super::esp32::{chip_display_name, connect};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EfuseFieldValue {
    pub name: String,
    pub value: u32,
    pub bit_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EfuseSecuritySummary {
    pub chip: String,
    pub fields: Vec<EfuseFieldValue>,
}

fn security_fields(chip: Chip) -> Vec<(&'static str, EfuseField)> {
    match chip {
        Chip::Esp32 => vec![
            ("FLASH_CRYPT_CNT", efuse::esp32::FLASH_CRYPT_CNT),
            ("ABS_DONE_0", efuse::esp32::ABS_DONE_0),
            ("ABS_DONE_1", efuse::esp32::ABS_DONE_1),
            ("JTAG_DISABLE", efuse::esp32::JTAG_DISABLE),
            ("UART_DOWNLOAD_DIS", efuse::esp32::UART_DOWNLOAD_DIS),
        ],
        Chip::Esp32s2 => vec![
            ("SPI_BOOT_CRYPT_CNT", efuse::esp32s2::SPI_BOOT_CRYPT_CNT),
            ("SECURE_BOOT_EN", efuse::esp32s2::SECURE_BOOT_EN),
        ],
        Chip::Esp32s3 => vec![
            ("SPI_BOOT_CRYPT_CNT", efuse::esp32s3::SPI_BOOT_CRYPT_CNT),
            ("SECURE_BOOT_EN", efuse::esp32s3::SECURE_BOOT_EN),
            ("DIS_PAD_JTAG", efuse::esp32s3::DIS_PAD_JTAG),
            ("DIS_USB_JTAG", efuse::esp32s3::DIS_USB_JTAG),
        ],
        Chip::Esp32c2 => vec![
            ("SPI_BOOT_CRYPT_CNT", efuse::esp32c2::SPI_BOOT_CRYPT_CNT),
            ("SECURE_BOOT_EN", efuse::esp32c2::SECURE_BOOT_EN),
        ],
        Chip::Esp32c3 => vec![
            ("SPI_BOOT_CRYPT_CNT", efuse::esp32c3::SPI_BOOT_CRYPT_CNT),
            ("SECURE_BOOT_EN", efuse::esp32c3::SECURE_BOOT_EN),
            ("DIS_PAD_JTAG", efuse::esp32c3::DIS_PAD_JTAG),
            ("DIS_USB_JTAG", efuse::esp32c3::DIS_USB_JTAG),
        ],
        Chip::Esp32c5 => vec![
            ("SPI_BOOT_CRYPT_CNT", efuse::esp32c5::SPI_BOOT_CRYPT_CNT),
            ("SECURE_BOOT_EN", efuse::esp32c5::SECURE_BOOT_EN),
        ],
        Chip::Esp32c6 => vec![
            ("SPI_BOOT_CRYPT_CNT", efuse::esp32c6::SPI_BOOT_CRYPT_CNT),
            ("SECURE_BOOT_EN", efuse::esp32c6::SECURE_BOOT_EN),
        ],
        Chip::Esp32c61 => vec![
            ("SPI_BOOT_CRYPT_CNT", efuse::esp32c61::SPI_BOOT_CRYPT_CNT),
            ("SECURE_BOOT_EN", efuse::esp32c61::SECURE_BOOT_EN),
        ],
        Chip::Esp32h2 => vec![
            ("SPI_BOOT_CRYPT_CNT", efuse::esp32h2::SPI_BOOT_CRYPT_CNT),
            ("SECURE_BOOT_EN", efuse::esp32h2::SECURE_BOOT_EN),
            ("DIS_PAD_JTAG", efuse::esp32h2::DIS_PAD_JTAG),
        ],
        Chip::Esp32p4 => vec![
            ("SPI_BOOT_CRYPT_CNT", efuse::esp32p4::SPI_BOOT_CRYPT_CNT),
            ("SECURE_BOOT_EN", efuse::esp32p4::SECURE_BOOT_EN),
        ],
        _ => vec![],
    }
}

/// Reads the curated set of security-relevant eFuses for whichever chip is
/// on the other end of `port_name`.
pub fn read_security_summary(port_name: &str) -> Result<EfuseSecuritySummary, String> {
    let mut flasher = connect(port_name, 115_200)?;
    let chip = flasher.chip();
    let fields = security_fields(chip);
    let connection = flasher.connection();
    let mut values = Vec::with_capacity(fields.len());
    for (name, field) in fields {
        let bit_count = field.bit_count;
        let value = chip
            .read_efuse_le::<u32>(connection, field)
            .map_err(|e| e.to_string())?;
        values.push(EfuseFieldValue {
            name: name.to_string(),
            value,
            bit_count,
        });
    }
    Ok(EfuseSecuritySummary {
        chip: chip_display_name(chip).to_string(),
        fields: values,
    })
}

/// Burns `value` into the named eFuse field (must be one of the fields
/// returned by [`read_security_summary`] for this chip) and returns the
/// freshly re-read value.
///
/// eFuses are one-time-programmable — this is **irreversible**. The
/// caller is expected to have already gotten an explicit typed
/// confirmation from the user, not just a yes/no dialog.
pub fn burn_security_field(port_name: &str, field_name: &str, value: u32) -> Result<u32, String> {
    let mut flasher = connect(port_name, 115_200)?;
    let chip = flasher.chip();
    let field = security_fields(chip)
        .into_iter()
        .find(|(name, _)| *name == field_name)
        .map(|(_, field)| field)
        .ok_or_else(|| format!("'{field_name}' is not a known security eFuse for {chip:?}"))?;

    if field.bit_count > 32 {
        return Err("eFuse fields wider than 32 bits are not supported".to_string());
    }
    let word_local_bit = field.bit_start % 32;
    if word_local_bit + field.bit_count > 32 {
        return Err("eFuse field crosses a 32-bit word boundary, unsupported".to_string());
    }
    let max = if field.bit_count == 32 {
        u32::MAX
    } else {
        (1u32 << field.bit_count) - 1
    };
    if value > max {
        return Err(format!(
            "value {value} does not fit in {} bit(s)",
            field.bit_count
        ));
    }

    let word_index = field.bit_start / 32;
    let word_value = value << word_local_bit;
    let mut data = vec![0u8; ((word_index + 1) * 4) as usize];
    data[(word_index * 4) as usize..].copy_from_slice(&word_value.to_le_bytes());

    let connection = flasher.connection();
    chip.write_efuse(connection, field.block, &data)
        .map_err(|e| e.to_string())?;
    chip.read_efuse_le::<u32>(connection, field)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn security_fields_covers_every_esp32_variant() {
        let all_chips = [
            Chip::Esp32,
            Chip::Esp32s2,
            Chip::Esp32s3,
            Chip::Esp32c2,
            Chip::Esp32c3,
            Chip::Esp32c5,
            Chip::Esp32c6,
            Chip::Esp32c61,
            Chip::Esp32h2,
            Chip::Esp32p4,
        ];
        for chip in all_chips {
            assert!(
                !security_fields(chip).is_empty(),
                "no security fields defined for {chip:?}"
            );
        }
    }

    #[test]
    fn read_security_summary_errors_on_bad_port() {
        let result = read_security_summary("__no_such_port__");
        assert!(result.is_err());
    }

    #[test]
    fn burn_security_field_errors_on_bad_port() {
        let result = burn_security_field("__no_such_port__", "FLASH_CRYPT_CNT", 1);
        assert!(result.is_err());
    }
}
