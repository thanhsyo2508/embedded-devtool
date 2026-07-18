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
use std::time::UNIX_EPOCH;

use russh::client::{self, Config};
use russh::Disconnect;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

struct SftpSshHandler;

impl client::Handler for SftpSshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
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

pub struct SftpManager {
    sessions: Mutex<HashMap<String, SftpSessionEntry>>,
}

impl Default for SftpManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SftpManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub async fn connect(
        &self,
        id: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
    ) -> Result<(), String> {
        let config = Arc::new(Config::default());
        let mut handle = client::connect(config, (host, port), SftpSshHandler)
            .await
            .map_err(|e| format!("failed to connect: {e}"))?;
        match handle.authenticate_password(username, password).await {
            Ok(result) if result.success() => {}
            Ok(_) => return Err("authentication failed".to_string()),
            Err(e) => return Err(e.to_string()),
        }
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
        self.sessions.lock().await.insert(
            id.to_string(),
            SftpSessionEntry {
                _ssh_handle: handle,
                sftp,
            },
        );
        Ok(())
    }

    pub async fn disconnect(&self, id: &str) {
        if let Some(entry) = self.sessions.lock().await.remove(id) {
            let _ = entry.sftp.close().await;
            let _ = entry
                ._ssh_handle
                .disconnect(Disconnect::ByApplication, "", "English")
                .await;
        }
    }

    pub async fn list(&self, id: &str, path: &str) -> Result<Vec<SftpEntry>, String> {
        let sessions = self.sessions.lock().await;
        let entry = sessions
            .get(id)
            .ok_or_else(|| format!("no SFTP session '{id}' — connect first"))?;
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
        let sessions = self.sessions.lock().await;
        let entry = sessions
            .get(id)
            .ok_or_else(|| format!("no SFTP session '{id}' — connect first"))?;
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
        let sessions = self.sessions.lock().await;
        let entry = sessions
            .get(id)
            .ok_or_else(|| format!("no SFTP session '{id}' — connect first"))?;
        let mut file = entry.sftp.create(path).await.map_err(|e| e.to_string())?;
        file.write_all(content).await.map_err(|e| e.to_string())?;
        file.shutdown().await.map_err(|e| e.to_string())
    }

    pub async fn mkdir(&self, id: &str, path: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let entry = sessions
            .get(id)
            .ok_or_else(|| format!("no SFTP session '{id}' — connect first"))?;
        entry.sftp.create_dir(path).await.map_err(|e| e.to_string())
    }

    pub async fn rmdir(&self, id: &str, path: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let entry = sessions
            .get(id)
            .ok_or_else(|| format!("no SFTP session '{id}' — connect first"))?;
        entry.sftp.remove_dir(path).await.map_err(|e| e.to_string())
    }

    pub async fn delete(&self, id: &str, path: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let entry = sessions
            .get(id)
            .ok_or_else(|| format!("no SFTP session '{id}' — connect first"))?;
        entry
            .sftp
            .remove_file(path)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn rename(&self, id: &str, from: &str, to: &str) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let entry = sessions
            .get(id)
            .ok_or_else(|| format!("no SFTP session '{id}' — connect first"))?;
        entry.sftp.rename(from, to).await.map_err(|e| e.to_string())
    }

    pub async fn download(
        &self,
        id: &str,
        remote_path: &str,
        local_path: &str,
    ) -> Result<(), String> {
        let bytes = self.read_file(id, remote_path).await?;
        tokio::fs::write(local_path, bytes)
            .await
            .map_err(|e| format!("failed to write {local_path}: {e}"))
    }

    pub async fn upload(
        &self,
        id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> Result<(), String> {
        let bytes = tokio::fs::read(local_path)
            .await
            .map_err(|e| format!("failed to read {local_path}: {e}"))?;
        self.write_file(id, remote_path, &bytes).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn list_on_unknown_session_errors() {
        let manager = SftpManager::new();
        let err = manager.list("nope", "/").await.unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[tokio::test]
    async fn read_file_on_unknown_session_errors() {
        let manager = SftpManager::new();
        let err = manager.read_file("nope", "/x").await.unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[tokio::test]
    async fn write_file_on_unknown_session_errors() {
        let manager = SftpManager::new();
        let err = manager.write_file("nope", "/x", b"hi").await.unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[tokio::test]
    async fn mkdir_on_unknown_session_errors() {
        let manager = SftpManager::new();
        let err = manager.mkdir("nope", "/x").await.unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[tokio::test]
    async fn rmdir_on_unknown_session_errors() {
        let manager = SftpManager::new();
        let err = manager.rmdir("nope", "/x").await.unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[tokio::test]
    async fn delete_on_unknown_session_errors() {
        let manager = SftpManager::new();
        let err = manager.delete("nope", "/x").await.unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[tokio::test]
    async fn rename_on_unknown_session_errors() {
        let manager = SftpManager::new();
        let err = manager.rename("nope", "/x", "/y").await.unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[tokio::test]
    async fn disconnect_on_unknown_session_is_a_noop() {
        let manager = SftpManager::new();
        manager.disconnect("nope").await;
    }
}
