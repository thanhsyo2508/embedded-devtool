//! FTP client (RFC 959) via `suppaftp`'s blocking API — matches this
//! codebase's thread-per-command style, no async runtime needed. Sessions
//! are keyed by a caller-assigned id (same convention as `PortManager`),
//! since an FTP control connection is stateful (login, current directory,
//! transfer type) and every command after connect runs sequentially on the
//! same TCP connection — this is deliberately not a `DataStream`, since FTP
//! is a request/response file browser, not a byte stream.

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use suppaftp::list::ListParser;
use suppaftp::types::FileType;
use suppaftp::FtpStream;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    /// Milliseconds since the Unix epoch, or 0 if the server's LIST line
    /// didn't carry a usable timestamp (format varies a lot server to
    /// server — never worth failing the whole listing over).
    pub modified_ms: i64,
}

fn parse_list_line(line: &str) -> Option<FtpEntry> {
    let file = ListParser::parse_posix(line)
        .or_else(|_| ListParser::parse_dos(line))
        .ok()?;
    let modified_ms = file
        .modified()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Some(FtpEntry {
        name: file.name().to_string(),
        is_dir: file.is_directory(),
        size: file.size() as u64,
        modified_ms,
    })
}

// Each session gets its own lock; the outer `sessions` lock only guards the
// map's shape and is never held across an FTP operation. Before this, one
// large download held the single map-wide lock for the whole transfer,
// blocking every other FTP command — including on unrelated sessions.
pub struct FtpManager {
    sessions: Mutex<HashMap<String, Arc<Mutex<FtpStream>>>>,
}

impl Default for FtpManager {
    fn default() -> Self {
        Self::new()
    }
}

impl FtpManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn connect(
        &self,
        id: &str,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
    ) -> Result<(), String> {
        let mut stream =
            FtpStream::connect((host, port)).map_err(|e| format!("failed to connect: {e}"))?;
        stream
            .login(username, password)
            .map_err(|e| format!("login failed: {e}"))?;
        stream
            .transfer_type(FileType::Binary)
            .map_err(|e| e.to_string())?;
        self.sessions
            .lock()
            .unwrap()
            .insert(id.to_string(), Arc::new(Mutex::new(stream)));
        Ok(())
    }

    pub fn disconnect(&self, id: &str) {
        let stream = self.sessions.lock().unwrap().remove(id);
        if let Some(stream) = stream {
            let _ = stream.lock().unwrap().quit();
        }
    }

    fn with_session<T>(
        &self,
        id: &str,
        f: impl FnOnce(&mut FtpStream) -> suppaftp::FtpResult<T>,
    ) -> Result<T, String> {
        let stream = self
            .sessions
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| format!("no FTP session '{id}' — connect first"))?;
        let mut stream = stream.lock().unwrap();
        f(&mut stream).map_err(|e| e.to_string())
    }

    pub fn pwd(&self, id: &str) -> Result<String, String> {
        self.with_session(id, |s| s.pwd())
    }

    pub fn list(&self, id: &str, path: &str) -> Result<Vec<FtpEntry>, String> {
        let path_opt = if path.is_empty() { None } else { Some(path) };
        let lines = self.with_session(id, |s| s.list(path_opt))?;
        Ok(lines
            .iter()
            .filter_map(|line| parse_list_line(line))
            .collect())
    }

    pub fn cwd(&self, id: &str, path: &str) -> Result<(), String> {
        self.with_session(id, |s| s.cwd(path))
    }

    pub fn mkdir(&self, id: &str, path: &str) -> Result<(), String> {
        self.with_session(id, |s| s.mkdir(path))
    }

    pub fn rmdir(&self, id: &str, path: &str) -> Result<(), String> {
        self.with_session(id, |s| s.rmdir(path))
    }

    pub fn delete(&self, id: &str, path: &str) -> Result<(), String> {
        self.with_session(id, |s| s.rm(path))
    }

    pub fn rename(&self, id: &str, from: &str, to: &str) -> Result<(), String> {
        self.with_session(id, |s| s.rename(from, to))
    }

    pub fn download(&self, id: &str, remote_path: &str, local_path: &str) -> Result<(), String> {
        let cursor = self.with_session(id, |s| s.retr_as_buffer(remote_path))?;
        std::fs::write(local_path, cursor.into_inner())
            .map_err(|e| format!("failed to write {local_path}: {e}"))
    }

    pub fn upload(&self, id: &str, local_path: &str, remote_path: &str) -> Result<(), String> {
        let bytes =
            std::fs::read(local_path).map_err(|e| format!("failed to read {local_path}: {e}"))?;
        let mut cursor = Cursor::new(bytes);
        self.with_session(id, |s| s.put_file(remote_path, &mut cursor).map(|_| ()))
    }
}
