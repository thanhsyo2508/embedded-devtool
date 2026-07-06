//! LAN IP + common-port scanner: sweeps a CIDR range and TCP-connects to a
//! set of commonly-used ports per host, reporting each open port as it's
//! found. This complements `lib.rs::mdns_scan` — mDNS only finds devices
//! that advertise themselves; this finds anything with an open port,
//! including plain HTTP/Telnet/Modbus servers that don't speak mDNS.
//!
//! Concurrency is a small fixed worker pool pulling from a channel, not one
//! thread per (ip, port) pair — a /24 × a dozen ports is thousands of
//! attempts, and not an async runtime either, matching the rest of `net/`.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::sync::Arc;
use std::time::Duration;

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Ports worth checking on an embedded/IoT LAN by default — device web UIs,
/// OTA/update servers, and the protocols this app already speaks elsewhere
/// (MQTT, Modbus TCP) are weighted over general-purpose server ports.
pub const COMMON_PORTS: &[(u16, &str)] = &[
    (21, "FTP"),
    (22, "SSH"),
    (23, "Telnet"),
    (25, "SMTP"),
    (53, "DNS"),
    (80, "HTTP"),
    (110, "POP3"),
    (143, "IMAP"),
    (443, "HTTPS"),
    (502, "Modbus TCP"),
    (554, "RTSP"),
    (1883, "MQTT"),
    (3306, "MySQL"),
    (5000, "HTTP-alt"),
    (5683, "CoAP"),
    (8080, "HTTP-alt"),
    (8081, "HTTP-alt"),
    (8883, "MQTTS"),
    (8888, "HTTP-alt"),
    (9000, "HTTP-alt"),
];

/// Largest range this will expand — bigger than a /20 (4094 hosts) is
/// almost always a typo and would otherwise hang the app for minutes.
const MAX_HOSTS: u32 = 4096;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortHit {
    pub ip: String,
    pub port: u16,
    pub service: String,
}

pub fn service_name(port: u16) -> &'static str {
    COMMON_PORTS
        .iter()
        .find(|(p, _)| *p == port)
        .map(|(_, name)| *name)
        .unwrap_or("unknown")
}

/// Reads the OS ARP/neighbor cache via the `arp -a` command — parsing is
/// deliberately loose (a generic IPv4 pattern + a generic MAC pattern found
/// on the same line) since the exact column layout differs across
/// Windows/Linux/macOS and isn't something to depend on staying stable. A
/// host missing from the result just leaves its MAC column blank in the UI
/// rather than failing the scan — the entry only exists in the OS cache
/// once something (our own connect attempts, moments earlier) has actually
/// talked to that address.
pub fn arp_table() -> HashMap<String, String> {
    let Ok(output) = std::process::Command::new("arp").arg("-a").output() else {
        return HashMap::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let ip_re = Regex::new(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b").unwrap();
    let mac_re = Regex::new(r"\b([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}\b").unwrap();

    let mut map = HashMap::new();
    for line in text.lines() {
        if let (Some(ip_m), Some(mac_m)) = (ip_re.find(line), mac_re.find(line)) {
            let mac = mac_m.as_str().to_uppercase().replace('-', ":");
            map.insert(ip_m.as_str().to_string(), mac);
        }
    }
    map
}

/// Best-effort reverse DNS lookup — `None` on any failure (no PTR record,
/// resolver timeout, etc.) rather than an error, since a blank name is a
/// perfectly normal outcome for most LAN devices.
pub fn reverse_dns(ip: Ipv4Addr) -> Option<String> {
    dns_lookup::lookup_addr(&IpAddr::V4(ip)).ok()
}

/// Parses IPv4 CIDR notation ("192.168.1.0/24") into the individual host
/// addresses to scan, excluding the network/broadcast addresses when the
/// range has more than two hosts.
pub fn expand_cidr(cidr: &str) -> Result<Vec<Ipv4Addr>, String> {
    let (base, prefix) = cidr
        .split_once('/')
        .ok_or_else(|| "expected CIDR notation, e.g. 192.168.1.0/24".to_string())?;
    let base: Ipv4Addr = base
        .trim()
        .parse()
        .map_err(|_| format!("invalid IP address: {base}"))?;
    let prefix: u32 = prefix
        .trim()
        .parse()
        .map_err(|_| format!("invalid prefix length: {prefix}"))?;
    if prefix > 32 {
        return Err("prefix length must be between 0 and 32".to_string());
    }

    let host_bits = 32 - prefix;
    let count: u32 = 1u64.checked_shl(host_bits).unwrap_or(0).min(u32::MAX as u64) as u32;
    if count > MAX_HOSTS {
        return Err(format!(
            "range too large ({count} addresses) — narrow it to /20 or smaller ({MAX_HOSTS} max)"
        ));
    }

    let mask = if prefix == 0 { 0 } else { u32::MAX << host_bits };
    let network = u32::from(base) & mask;

    let mut ips = Vec::with_capacity(count as usize);
    for i in 0..count {
        if count > 2 && (i == 0 || i == count - 1) {
            continue; // skip network/broadcast addresses
        }
        ips.push(Ipv4Addr::from(network + i));
    }
    Ok(ips)
}

/// Attempts a TCP connect to every (ip, port) pair, calling `on_hit` for
/// each that succeeds. Blocks until every attempt has finished or timed
/// out — callers run this on a background thread.
pub fn scan_ports<F>(ips: &[Ipv4Addr], ports: &[u16], timeout_ms: u64, on_hit: F)
where
    F: Fn(PortHit) + Send + Sync + 'static,
{
    const WORKERS: usize = 128;
    let timeout = Duration::from_millis(timeout_ms.clamp(100, 5_000));
    let on_hit = Arc::new(on_hit);

    let (tx, rx) = crossbeam_channel::unbounded::<(Ipv4Addr, u16)>();
    for &ip in ips {
        for &port in ports {
            let _ = tx.send((ip, port));
        }
    }
    drop(tx);

    let handles: Vec<_> = (0..WORKERS.min(ips.len().max(1) * ports.len().max(1)).max(1))
        .map(|_| {
            let rx = rx.clone();
            let on_hit = on_hit.clone();
            std::thread::spawn(move || {
                for (ip, port) in rx {
                    let addr = SocketAddr::new(IpAddr::V4(ip), port);
                    if TcpStream::connect_timeout(&addr, timeout).is_ok() {
                        on_hit(PortHit {
                            ip: ip.to_string(),
                            port,
                            service: service_name(port).to_string(),
                        });
                    }
                }
            })
        })
        .collect();

    for handle in handles {
        let _ = handle.join();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_slash_24_excluding_network_and_broadcast() {
        let ips = expand_cidr("192.168.1.0/24").unwrap();
        assert_eq!(ips.len(), 254);
        assert!(!ips.contains(&Ipv4Addr::new(192, 168, 1, 0)));
        assert!(!ips.contains(&Ipv4Addr::new(192, 168, 1, 255)));
        assert!(ips.contains(&Ipv4Addr::new(192, 168, 1, 1)));
        assert!(ips.contains(&Ipv4Addr::new(192, 168, 1, 254)));
    }

    #[test]
    fn expands_slash_32_to_single_host() {
        let ips = expand_cidr("10.0.0.5/32").unwrap();
        assert_eq!(ips, vec![Ipv4Addr::new(10, 0, 0, 5)]);
    }

    #[test]
    fn rejects_oversized_range() {
        let err = expand_cidr("10.0.0.0/8").unwrap_err();
        assert!(err.contains("too large"));
    }

    #[test]
    fn rejects_malformed_input() {
        assert!(expand_cidr("not-a-cidr").is_err());
        assert!(expand_cidr("10.0.0.0/33").is_err());
        assert!(expand_cidr("999.0.0.0/24").is_err());
    }

    #[test]
    fn known_port_resolves_service_name() {
        assert_eq!(service_name(1883), "MQTT");
        assert_eq!(service_name(65000), "unknown");
    }
}
