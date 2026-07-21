//! SFTP client via `russh-sftp` layered on its own `russh` SSH connection.
//! Sessions are keyed by a caller-assigned id (same convention as
//! `FtpManager`/`PortManager`) — here, the id is always an already-open SSH
//! tab's own id, so this session lifecycle is meant to track that tab's,
//! but the manager itself has no dependency on `core::ssh_stream` or
//! `NetworkManager`.
//!
//! Deliberately its own independent SSH connection rather than reusing the
//! paired SSH tab's authenticated session: `core::ssh_stream::SshStream`
//! never exposes its `russh::client::Handle` outside the worker thread that
//! owns the interactive PTY, so sharing it would mean restructuring that
//! (working, PTY-focused) code. Paying for a second TCP+SSH handshake here
//! is the surgical tradeoff.
//!
//! Unlike `FtpManager` (blocking `suppaftp`, `std::sync::Mutex`), `russh`/
//! `russh-sftp` are async end to end, so sessions live behind a
//! `tokio::sync::Mutex` and every method is `async fn`, awaited directly
//! from `async fn` Tauri commands (Tauri v2 runs those on its own runtime,
//! no manual `block_on`/thread needed).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use russh::client::{self, Config};
use russh::Disconnect;
use russh_sftp::client::SftpSession;

use crate::core::known_hosts::{self, KnownHosts};
use crate::core::ssh_auth::{self, SshAuth};
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use tokio::time::timeout;

/// Chunk size for download/upload progress reporting — small enough that a
/// multi-MB firmware image or log file reports progress in reasonably fine
/// steps, large enough that a typical config-file-sized transfer (this
/// app's common case) doesn't spam dozens of near-instant progress events.
const TRANSFER_CHUNK_SIZE: usize = 256 * 1024;

/// Bounds the whole connect+auth+subsystem sequence in `connect()` below —
/// unlike `core::ssh_stream::SshStream` (which bounds its own connect with
/// `CONNECT_TIMEOUT` via a channel `recv_timeout`), nothing here capped the
/// SSH dial, auth round-trip, or SFTP subsystem request, so a stalled peer
/// (or one that accepts the TCP connection but never replies) hung this
/// forever with no way for the user to give up. Same reasoning as
/// `ftp::client::FtpManager::connect`'s fix.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Same `core::known_hosts`-backed TOFU check as `core::ssh_stream`'s own
/// handler (this is a separate connection, per this module's own doc
/// comment, so it needs its own copy of the handler — sharing the SSH tab's
/// wasn't an option there either).
struct SftpSshHandler {
    known_hosts: Arc<KnownHosts>,
    host: String,
    port: u16,
}

impl client::Handler for SftpSshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        match known_hosts::verify_host_key(
            &self.known_hosts,
            &self.host,
            self.port,
            server_public_key,
        ) {
            Ok(()) => Ok(true),
            Err(msg) => Err(russh::Error::InvalidConfig(msg)),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    /// Full path, joined server-side (`DirEntry::path()`) — unlike
    /// `FtpEntry`, `list()` here is stateless per call (no server-side cwd
    /// pointer, since a tree view can have many directories expanded at
    /// once), so the frontend would otherwise have to join `base + name`
    /// itself across every expanded node. Handing back the canonical path
    /// removes that whole class of bug.
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    /// Milliseconds since the Unix epoch, or 0 if unavailable.
    pub modified_ms: i64,
}

struct SftpSessionEntry {
    // Keeps the SSH connection alive -- the SFTP subsystem channel's stream
    // is derived from this Handle, so dropping it closes the channel. Never
    // read directly after connect(), hence the leading underscore.
    _ssh_handle: client::Handle<SftpSshHandler>,
    sftp: SftpSession,
}

// The `sessions` lock only guards the map's shape and is held just long
// enough to clone an entry's Arc — never across an awaited SFTP operation.
// Holding it across awaits meant one large read_file() serialized every
// other SFTP call (all sessions) behind the whole transfer.
pub struct SftpManager {
    sessions: Mutex<HashMap<String, Arc<SftpSessionEntry>>>,
    known_hosts: Arc<KnownHosts>,
}

impl SftpManager {
    pub fn new(known_hosts: Arc<KnownHosts>) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            known_hosts,
        }
    }

    /// `private_key_path` (non-empty) selects key-based auth over
    /// `password` — see `core::ssh_auth::SshAuth`.
    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        &self,
        id: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        private_key_path: Option<&str>,
        passphrase: Option<&str>,
    ) -> Result<(), String> {
        let auth = match private_key_path {
            Some(path) if !path.is_empty() => SshAuth::PrivateKey {
                path: path.to_string(),
                passphrase: passphrase.map(|p| p.to_string()),
            },
            _ => SshAuth::Password(password.to_string()),
        };
        let config = Arc::new(Config::default());
        let ssh_handler = SftpSshHandler {
            known_hosts: self.known_hosts.clone(),
            host: host.to_string(),
            port,
        };
        let entry = timeout(CONNECT_TIMEOUT, async move {
            let mut handle = client::connect(config, (host, port), ssh_handler)
                .await
                .map_err(|e| format!("failed to connect: {e}"))?;
            ssh_auth::authenticate(&mut handle, username, &auth).await?;
            let channel = handle
                .channel_open_session()
                .await
                .map_err(|e| e.to_string())?;
            channel
                .request_subsystem(true, "sftp")
                .await
                .map_err(|e| e.to_string())?;
            let sftp = SftpSession::new(channel.into_stream())
                .await
                .map_err(|e| e.to_string())?;
            Ok::<_, String>(SftpSessionEntry {
                _ssh_handle: handle,
                sftp,
            })
        })
        .await
        .map_err(|_| "timed out connecting to SFTP server".to_string())??;
        self.sessions
            .lock()
            .await
            .insert(id.to_string(), Arc::new(entry));
        Ok(())
    }

    /// Clones the session handle under the map lock, releasing it before the
    /// caller awaits anything on the session.
    async fn get(&self, id: &str) -> Result<Arc<SftpSessionEntry>, String> {
        self.sessions
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| format!("no SFTP session '{id}' — connect first"))
    }

    pub async fn disconnect(&self, id: &str) {
        let entry = self.sessions.lock().await.remove(id);
        if let Some(entry) = entry {
            let _ = entry.sftp.close().await;
            let _ = entry
                ._ssh_handle
                .disconnect(Disconnect::ByApplication, "", "English")
                .await;
        }
    }

    pub async fn list(&self, id: &str, path: &str) -> Result<Vec<SftpEntry>, String> {
        let entry = self.get(id).await?;
        // An empty path (the frontend's root-node sentinel) isn't guaranteed
        // to resolve consistently across SFTP server implementations, and
        // even where a server accepts it, DirEntry::path() would then return
        // bare filenames (no leading directory) for every root-level entry,
        // since it joins onto whatever path was passed to read_dir(). Real
        // SFTP clients (OpenSSH's own `sftp` CLI, VSCode's Remote-SSH)
        // resolve "." via realpath first to get the actual home directory,
        // then list that — same fix here.
        let resolved = if path.is_empty() {
            entry
                .sftp
                .canonicalize(".")
                .await
                .map_err(|e| e.to_string())?
        } else {
            path.to_string()
        };
        let read_dir = entry
            .sftp
            .read_dir(&resolved)
            .await
            .map_err(|e| e.to_string())?;
        let mut out: Vec<SftpEntry> = read_dir
            .map(|de| {
                let metadata = de.metadata();
                let modified_ms = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                SftpEntry {
                    name: de.file_name(),
                    path: de.path(),
                    is_dir: metadata.is_dir(),
                    is_symlink: metadata.is_symlink(),
                    size: metadata.len(),
                    modified_ms,
                }
            })
            .collect();
        out.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(out)
    }

    pub async fn read_file(&self, id: &str, path: &str) -> Result<Vec<u8>, String> {
        let entry = self.get(id).await?;
        entry.sftp.read(path).await.map_err(|e| e.to_string())
    }

    /// Writes `content`, creating the file if absent and truncating it if
    /// present. Deliberately uses `SftpSession::create()` (which opens with
    /// `CREATE|TRUNCATE|WRITE`) rather than the crate's own `.write()`
    /// convenience method — that method opens with `WRITE` only, so it
    /// errors on a file that doesn't exist yet and, worse, leaves stale
    /// trailing bytes when the new content is shorter than what's already
    /// on the remote file.
    pub async fn write_file(&self, id: &str, path: &str, content: &[u8]) -> Result<(), String> {
        let entry = self.get(id).await?;
        let mut file = entry.sftp.create(path).await.map_err(|e| e.to_string())?;
        file.write_all(content).await.map_err(|e| e.to_string())?;
        file.shutdown().await.map_err(|e| e.to_string())
    }

    pub async fn mkdir(&self, id: &str, path: &str) -> Result<(), String> {
        let entry = self.get(id).await?;
        entry.sftp.create_dir(path).await.map_err(|e| e.to_string())
    }

    pub async fn rmdir(&self, id: &str, path: &str) -> Result<(), String> {
        let entry = self.get(id).await?;
        entry.sftp.remove_dir(path).await.map_err(|e| e.to_string())
    }

    pub async fn delete(&self, id: &str, path: &str) -> Result<(), String> {
        let entry = self.get(id).await?;
        entry
            .sftp
            .remove_file(path)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn rename(&self, id: &str, from: &str, to: &str) -> Result<(), String> {
        let entry = self.get(id).await?;
        entry.sftp.rename(from, to).await.map_err(|e| e.to_string())
    }

    /// Downloads in chunks (rather than `read_file`'s whole-file-into-memory
    /// shot) so `on_progress(bytes_so_far, total_bytes)` can report progress
    /// for a large transfer instead of the caller only finding out once the
    /// entire thing has already completed.
    pub async fn download(
        &self,
        id: &str,
        remote_path: &str,
        local_path: &str,
        mut on_progress: impl FnMut(u64, u64) + Send,
    ) -> Result<(), String> {
        let entry = self.get(id).await?;
        let total = entry
            .sftp
            .metadata(remote_path)
            .await
            .map(|m| m.len())
            .unwrap_or(0);
        let mut remote_file = entry
            .sftp
            .open(remote_path)
            .await
            .map_err(|e| e.to_string())?;
        let mut local_file = tokio::fs::File::create(local_path)
            .await
            .map_err(|e| format!("failed to write {local_path}: {e}"))?;
        let mut buf = vec![0u8; TRANSFER_CHUNK_SIZE];
        let mut transferred: u64 = 0;
        loop {
            let n = remote_file
                .read(&mut buf)
                .await
                .map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            local_file
                .write_all(&buf[..n])
                .await
                .map_err(|e| format!("failed to write {local_path}: {e}"))?;
            transferred += n as u64;
            on_progress(transferred, total);
        }
        local_file
            .flush()
            .await
            .map_err(|e| format!("failed to write {local_path}: {e}"))
    }

    /// Same chunked-with-progress shape as `download`, and the same
    /// `.create()`-not-`.write()` truncation reasoning as `write_file`.
    pub async fn upload(
        &self,
        id: &str,
        local_path: &str,
        remote_path: &str,
        mut on_progress: impl FnMut(u64, u64) + Send,
    ) -> Result<(), String> {
        let entry = self.get(id).await?;
        let mut local_file = tokio::fs::File::open(local_path)
            .await
            .map_err(|e| format!("failed to read {local_path}: {e}"))?;
        let total = local_file.metadata().await.map(|m| m.len()).unwrap_or(0);
        let mut remote_file = entry
            .sftp
            .create(remote_path)
            .await
            .map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; TRANSFER_CHUNK_SIZE];
        let mut transferred: u64 = 0;
        loop {
            let n = local_file
                .read(&mut buf)
                .await
                .map_err(|e| format!("failed to read {local_path}: {e}"))?;
            if n == 0 {
                break;
            }
            remote_file
                .write_all(&buf[..n])
                .await
                .map_err(|e| e.to_string())?;
            transferred += n as u64;
            on_progress(transferred, total);
        }
        remote_file.shutdown().await.map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // None of these tests actually connect, so this path is never read
    // from or written to — any placeholder works.
    fn test_manager() -> SftpManager {
        SftpManager::new(Arc::new(KnownHosts::load(std::path::PathBuf::from(
            "unused-test-known-hosts",
        ))))
    }

    #[tokio::test]
    async fn list_on_unknown_session_errors() {
        let manager = test_manager();
        let err = manager.list("nope", "/").await.unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[tokio::test]
    async fn read_file_on_unknown_session_errors() {
        let manager = test_manager();
        let err = manager.read_file("nope", "/x").await.unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[tokio::test]
    async fn write_file_on_unknown_session_errors() {
        let manager = test_manager();
        let err = manager.write_file("nope", "/x", b"hi").await.unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[tokio::test]
    async fn mkdir_on_unknown_session_errors() {
        let manager = test_manager();
        let err = manager.mkdir("nope", "/x").await.unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[tokio::test]
    async fn rmdir_on_unknown_session_errors() {
        let manager = test_manager();
        let err = manager.rmdir("nope", "/x").await.unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[tokio::test]
    async fn delete_on_unknown_session_errors() {
        let manager = test_manager();
        let err = manager.delete("nope", "/x").await.unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[tokio::test]
    async fn rename_on_unknown_session_errors() {
        let manager = test_manager();
        let err = manager.rename("nope", "/x", "/y").await.unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[tokio::test]
    async fn disconnect_on_unknown_session_is_a_noop() {
        let manager = test_manager();
        manager.disconnect("nope").await;
    }
}
