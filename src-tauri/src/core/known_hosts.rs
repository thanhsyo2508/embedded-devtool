//! Persistent "trust on first use" (TOFU) host-key store for the SSH
//! connections opened by `core::ssh_stream` and `sftp::client` — before
//! this, `check_server_key` always accepted every key unconditionally, so
//! there was no protection against a man-in-the-middle attack at all.
//!
//! This app has no synchronous bridge from deep inside a background
//! connect task back to the frontend, so the first connection to a given
//! `host:port` is trusted automatically rather than interactively
//! prompted (unlike OpenSSH's own "yes/no, are you sure?" on first
//! connect). What this *does* protect against — the part that matters
//! most in practice — is a host's key silently *changing* after that:
//! once a fingerprint is recorded, a later connection presenting a
//! different one is refused outright instead of silently accepted.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use russh::keys::{HashAlg, PublicKey};

pub enum HostKeyCheck {
    /// First time seeing this host:port — now recorded.
    Trusted,
    /// Matches the previously recorded fingerprint.
    Match,
    Mismatch {
        previous: String,
    },
}

pub struct KnownHosts {
    path: PathBuf,
    entries: Mutex<HashMap<String, String>>,
}

impl KnownHosts {
    /// Loads existing entries from `path` if present; starts empty
    /// (nothing trusted yet) if the file doesn't exist or fails to parse —
    /// never a fatal error, since this is a convenience cache, not the
    /// source of truth for identity the way a private key is.
    pub fn load(path: PathBuf) -> Self {
        let entries = std::fs::read_to_string(&path)
            .ok()
            .map(|content| {
                content
                    .lines()
                    .filter_map(|line| line.split_once(' '))
                    .map(|(host, fp)| (host.to_string(), fp.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        Self {
            path,
            entries: Mutex::new(entries),
        }
    }

    fn check(&self, host_port: &str, fingerprint: &str) -> HostKeyCheck {
        let mut entries = self.entries.lock().unwrap();
        match entries.get(host_port) {
            Some(existing) if existing == fingerprint => HostKeyCheck::Match,
            Some(existing) => HostKeyCheck::Mismatch {
                previous: existing.clone(),
            },
            None => {
                entries.insert(host_port.to_string(), fingerprint.to_string());
                self.save(&entries);
                HostKeyCheck::Trusted
            }
        }
    }

    /// One small text file, written only when a *new* host is trusted (not
    /// on every connect) — a plain synchronous write is simpler than
    /// threading this through the async callers for something this
    /// infrequent, and it never happens on a hot path.
    fn save(&self, entries: &HashMap<String, String>) {
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let content: String = entries
            .iter()
            .map(|(host_port, fingerprint)| format!("{host_port} {fingerprint}\n"))
            .collect();
        let _ = std::fs::write(&self.path, content);
    }

    /// Forgets a host, so its next connection is trusted fresh — the
    /// escape hatch for "I know the key legitimately changed (server
    /// reinstalled, etc.), let me back in."
    pub fn forget(&self, host_port: &str) {
        let mut entries = self.entries.lock().unwrap();
        if entries.remove(host_port).is_some() {
            self.save(&entries);
        }
    }
}

/// Called from both `ssh_stream::SshHandler` and `sftp::client::SftpSshHandler`'s
/// `check_server_key` — computes the key's fingerprint and checks it
/// against `known_hosts`, returning a human-readable error (rather than
/// `Ok(false)`, which `russh` turns into a generic "unknown key" with no
/// detail) on a mismatch.
pub fn verify_host_key(
    known_hosts: &KnownHosts,
    host: &str,
    port: u16,
    key: &PublicKey,
) -> Result<(), String> {
    let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
    let host_port = format!("{host}:{port}");
    match known_hosts.check(&host_port, &fingerprint) {
        HostKeyCheck::Trusted | HostKeyCheck::Match => Ok(()),
        HostKeyCheck::Mismatch { previous } => Err(format!(
            "host key for {host_port} has changed (was {previous}, now {fingerprint}) — this \
             could mean the server was reinstalled, or a man-in-the-middle attack. Refusing to \
             connect."
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Each test gets its own file (by name, not just pid) — cargo test
    // runs tests in parallel within one process, so sharing a path by pid
    // alone would let two tests race on the same file.
    fn temp_known_hosts(test_name: &str) -> KnownHosts {
        let path = std::env::temp_dir().join(format!(
            "edt-test-known-hosts-{test_name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        KnownHosts::load(path)
    }

    #[test]
    fn first_connection_is_trusted() {
        let kh = temp_known_hosts("first-connection");
        assert!(matches!(kh.check("host:22", "fp1"), HostKeyCheck::Trusted));
    }

    #[test]
    fn matching_fingerprint_is_accepted() {
        let kh = temp_known_hosts("matching-fingerprint");
        kh.check("host:22", "fp1");
        assert!(matches!(kh.check("host:22", "fp1"), HostKeyCheck::Match));
    }

    #[test]
    fn changed_fingerprint_is_rejected() {
        let kh = temp_known_hosts("changed-fingerprint");
        kh.check("host:22", "fp1");
        match kh.check("host:22", "fp2") {
            HostKeyCheck::Mismatch { previous } => assert_eq!(previous, "fp1"),
            _ => panic!("expected a mismatch"),
        }
    }

    #[test]
    fn different_ports_on_the_same_host_are_independent() {
        let kh = temp_known_hosts("different-ports");
        kh.check("host:22", "fp1");
        // A different port for the same host is a different entry — must
        // not be treated as a mismatch against the :22 entry.
        assert!(matches!(
            kh.check("host:2222", "fp2"),
            HostKeyCheck::Trusted
        ));
    }

    #[test]
    fn forget_clears_trust() {
        let kh = temp_known_hosts("forget");
        kh.check("host:22", "fp1");
        kh.forget("host:22");
        assert!(matches!(kh.check("host:22", "fp2"), HostKeyCheck::Trusted));
    }

    #[test]
    fn trust_persists_across_reload() {
        let path = std::env::temp_dir().join(format!(
            "edt-test-known-hosts-persist-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        {
            let kh = KnownHosts::load(path.clone());
            kh.check("host:22", "fp1");
        }
        let kh2 = KnownHosts::load(path.clone());
        assert!(matches!(kh2.check("host:22", "fp1"), HostKeyCheck::Match));
        let _ = std::fs::remove_file(&path);
    }
}
