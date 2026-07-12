//! ESP32 flashing (M2-T1), built on `espflash` as a library rather than
//! shelling out to a bundled `esptool` — avoids a Python dependency and
//! gives typed progress callbacks instead of scraping CLI output.
//!
//! Every function here opens its own exclusive serial connection and closes
//! it when done; it does not share a port with `serial::PortManager`. If the
//! same physical port is already open in a monitor tab, the OS will refuse
//! the second open and the resulting error is surfaced as-is — the user
//! needs to close the monitor connection before flashing the same port.

use std::fs;
use std::path::PathBuf;

use espflash::connection::{Connection, ResetAfterOperation, ResetBeforeOperation};
use espflash::flasher::{FlashSize, Flasher};
use espflash::image_format::Segment;
use espflash::target::Chip;
use serde::{Deserialize, Serialize};
use serialport::{SerialPortType, UsbPortInfo};

pub(crate) fn chip_display_name(chip: Chip) -> &'static str {
    match chip {
        Chip::Esp32 => "ESP32",
        Chip::Esp32c2 => "ESP32-C2",
        Chip::Esp32c3 => "ESP32-C3",
        Chip::Esp32c5 => "ESP32-C5",
        Chip::Esp32c6 => "ESP32-C6",
        Chip::Esp32c61 => "ESP32-C61",
        Chip::Esp32h2 => "ESP32-H2",
        Chip::Esp32p4 => "ESP32-P4",
        Chip::Esp32s2 => "ESP32-S2",
        Chip::Esp32s3 => "ESP32-S3",
        _ => "ESP32 (unknown variant)",
    }
}

fn flash_size_bytes(size: FlashSize) -> u32 {
    match size {
        FlashSize::_256Kb => 256 * 1024,
        FlashSize::_512Kb => 512 * 1024,
        FlashSize::_1Mb => 1024 * 1024,
        FlashSize::_2Mb => 2 * 1024 * 1024,
        FlashSize::_4Mb => 4 * 1024 * 1024,
        FlashSize::_8Mb => 8 * 1024 * 1024,
        FlashSize::_16Mb => 16 * 1024 * 1024,
        FlashSize::_32Mb => 32 * 1024 * 1024,
        FlashSize::_64Mb => 64 * 1024 * 1024,
        FlashSize::_128Mb => 128 * 1024 * 1024,
        _ => 0,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChipInfo {
    pub chip: String,
    pub revision: Option<String>,
    pub flash_size_bytes: u32,
    pub mac_address: Option<String>,
    pub features: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashSegmentReq {
    pub offset: u32,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum FlashProgress {
    Writing {
        addr: u32,
        current: usize,
        total: usize,
    },
    Verifying,
    SegmentDone,
}

fn usb_info_for_port(port_name: &str) -> UsbPortInfo {
    serialport::available_ports()
        .ok()
        .and_then(|ports| ports.into_iter().find(|p| p.port_name == port_name))
        .and_then(|p| match p.port_type {
            SerialPortType::UsbPort(info) => Some(info),
            _ => None,
        })
        .unwrap_or(UsbPortInfo {
            vid: 0,
            pid: 0,
            serial_number: None,
            manufacturer: None,
            product: None,
            // `usbportinfo-interface`, gated behind a serialport Cargo feature
            // that another dependency now enables via feature unification
            // (it wasn't part of this struct before probe-rs was added).
            interface: None,
        })
}

pub(crate) fn connect(port_name: &str, baud: u32) -> Result<Flasher, String> {
    let native_port = serialport::new(port_name, 115_200)
        .flow_control(serialport::FlowControl::None)
        .open_native()
        .map_err(|e| format!("failed to open {port_name}: {e}"))?;

    let connection = Connection::new(
        native_port,
        usb_info_for_port(port_name),
        ResetAfterOperation::default(),
        ResetBeforeOperation::default(),
        baud,
    );

    Flasher::connect(connection, true, true, true, None, Some(baud))
        .map_err(|e| format!("failed to connect to chip on {port_name}: {e}"))
}

/// M2-T1.2: auto-detects chip variant, MAC address, and flash size.
pub fn detect_chip(port_name: &str) -> Result<ChipInfo, String> {
    let mut flasher = connect(port_name, 115_200)?;
    let info = flasher.device_info().map_err(|e| e.to_string())?;
    Ok(ChipInfo {
        chip: chip_display_name(info.chip).to_string(),
        revision: info
            .revision
            .map(|(major, minor)| format!("{major}.{minor}")),
        flash_size_bytes: flash_size_bytes(info.flash_size),
        mac_address: info.mac_address,
        features: info.features,
    })
}

struct CallbackProgress<F: FnMut(FlashProgress)> {
    on_progress: F,
    addr: u32,
    total: usize,
}

impl<F: FnMut(FlashProgress)> espflash::target::ProgressCallbacks for CallbackProgress<F> {
    fn init(&mut self, addr: u32, total: usize) {
        self.addr = addr;
        self.total = total;
        (self.on_progress)(FlashProgress::Writing {
            addr,
            current: 0,
            total,
        });
    }

    fn update(&mut self, current: usize) {
        (self.on_progress)(FlashProgress::Writing {
            addr: self.addr,
            current,
            total: self.total,
        });
    }

    fn verifying(&mut self) {
        (self.on_progress)(FlashProgress::Verifying);
    }

    fn finish(&mut self, _skipped: bool) {
        (self.on_progress)(FlashProgress::SegmentDone);
    }
}

/// M2-T1.1/T1.3: writes one or more (offset, file) pairs to flash, verifying
/// after each segment (built into `Flasher::connect`'s `verify` flag).
pub fn flash_binaries(
    port_name: &str,
    baud: u32,
    segments: &[FlashSegmentReq],
    mut on_progress: impl FnMut(FlashProgress),
) -> Result<(), String> {
    let mut flasher = connect(port_name, baud)?;

    let mut file_bytes = Vec::with_capacity(segments.len());
    for seg in segments {
        let bytes = fs::read(&seg.path).map_err(|e| format!("failed to read {}: {e}", seg.path))?;
        file_bytes.push(bytes);
    }
    let espflash_segments: Vec<Segment> = segments
        .iter()
        .zip(file_bytes.iter())
        .map(|(seg, bytes)| Segment::new(seg.offset, bytes))
        .collect();

    let mut progress = CallbackProgress {
        on_progress: &mut on_progress,
        addr: 0,
        total: 0,
    };
    flasher
        .write_bins_to_flash(&espflash_segments, &mut progress)
        .map_err(|e| e.to_string())
}

/// M2-T1.5: erases the entire flash chip.
pub fn erase_flash(port_name: &str) -> Result<(), String> {
    let mut flasher = connect(port_name, 115_200)?;
    flasher.erase_flash().map_err(|e| e.to_string())
}

/// M2-T1.5: erases a specific flash region, e.g. to clear NVS without a full erase.
pub fn erase_region(port_name: &str, offset: u32, size: u32) -> Result<(), String> {
    let mut flasher = connect(port_name, 115_200)?;
    flasher
        .erase_region(offset, size)
        .map_err(|e| e.to_string())
}

/// M2-T1.5: reads a flash region out to a local file.
pub fn read_flash(
    port_name: &str,
    offset: u32,
    size: u32,
    out_path: PathBuf,
) -> Result<(), String> {
    const BLOCK_SIZE: u32 = 0x1000;
    const MAX_IN_FLIGHT: u32 = 64;
    let mut flasher = connect(port_name, 115_200)?;
    flasher
        .read_flash(offset, size, BLOCK_SIZE, MAX_IN_FLIGHT, out_path)
        .map_err(|e| e.to_string())
}
