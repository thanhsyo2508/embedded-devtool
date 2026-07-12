//! SWD debug support: listing attached probes, searching probe-rs's chip
//! database, and reading DWARF variable declarations. The actual live
//! session (attach, RTT, variable polling) lives in `core::rtt_stream` as a
//! `DataStream` impl so it reuses the Monitor's existing tab/log
//! infrastructure — this module only covers the "before you connect"
//! lookups the Connect panel needs.

pub mod variables;

use probe_rs::probe::list::Lister;
use probe_rs::probe::DebugProbeInfo;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeInfo {
    pub identifier: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub serial_number: Option<String>,
}

fn to_probe_info(info: &DebugProbeInfo) -> ProbeInfo {
    ProbeInfo {
        identifier: info.identifier.clone(),
        vendor_id: info.vendor_id,
        product_id: info.product_id,
        serial_number: info.serial_number.clone(),
    }
}

/// Lists every currently attached debug probe (ST-Link, J-Link, CMSIS-DAP,
/// ...) — read-only, safe to call any time.
pub fn list_probes() -> Vec<ProbeInfo> {
    Lister::new().list_all().iter().map(to_probe_info).collect()
}

/// Prefix-searches probe-rs's built-in chip database (case-insensitive,
/// `x` in the query matches any character) — lets the Connect panel offer
/// suggestions instead of requiring the exact probe-rs target string
/// (e.g. "STM32F407VG" already matches "STM32F407VGTx").
pub fn search_chips(query: &str) -> Vec<String> {
    if query.trim().is_empty() {
        return Vec::new();
    }
    let registry = probe_rs::config::Registry::from_builtin_families();
    let mut matches = registry.search_chips(query);
    matches.sort();
    matches.truncate(50);
    matches
}
