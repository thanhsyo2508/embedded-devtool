//! FTP client (RFC 959) via `suppaftp`'s blocking API — matches this
//! codebase's thread-per-command style, no async runtime needed. Sessions
//! are keyed by a caller-assigned id (same convention as `PortManager`),
//! since an FTP control connection is stateful (login, current directory,
//! transfer type) and every command after connect runs sequentially on the
//! same TCP connection — this is deliberately not a `DataStream`, since FTP
//! is a request/response file browser, not a byte stream.

use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use std::net::ToSocketAddrs;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, UNIX_EPOCH};

use regex::Regex;
use serde::Serialize;
use suppaftp::list::ListParser;
use suppaftp::types::FileType;
use suppaftp::{FtpError, FtpStream};

/// `FtpStream::connect` (and every command after it) uses a plain blocking
/// `TcpStream` with no timeout at all — against an unreachable host (wrong
/// IP, a firewall silently dropping the SYN instead of rejecting it) the
/// connect attempt hangs indefinitely, and `connect()` below has no other
/// way to give up. `connect_timeout` bounds the dial; the read/write
/// timeouts set on the control connection right after (see `connect()`)
/// bound every command sent over it afterward (`login`, `list`, ...) the
/// same way — same reasoning `core::ws_stream` already applies to its own
/// raw `TcpStream::connect_timeout` dial.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const IO_TIMEOUT: Duration = Duration::from_secs(30);

/// Chunk size for download/upload progress reporting — same constant and
/// same reasoning as `sftp::client`'s (large enough to not spam progress
/// events for a typical config-file-sized transfer, small enough to report
/// a multi-MB transfer in reasonably fine steps).
const TRANSFER_CHUNK_SIZE: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpEntry {
    pub name: String,
    /// Full path, joined client-side from the listed directory + `name` —
    /// unlike `SftpEntry` (whose path comes straight from the server's
    /// `DirEntry::path()`), an FTP `LIST` line only ever carries a bare
    /// filename, so the tree-view frontend would otherwise have to
    /// reconstruct `base + name` itself across every expanded node. Filled
    /// in by `list()`, not by the LIST-line parsers below (they don't know
    /// what directory was listed).
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// Milliseconds since the Unix epoch, or 0 if the server's LIST line
    /// didn't carry a usable timestamp (format varies a lot server to
    /// server — never worth failing the whole listing over).
    pub modified_ms: i64,
}

/// Joins a listed directory and an entry's bare name into a full FTP path.
/// `dir` is always either the caller's requested path or this session's
/// `pwd()` — both already absolute, so this never needs to handle a
/// relative `dir`.
fn join_ftp_path(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

/// Minimal embedded FTP servers (e.g. the Arduino "SimpleFTPServer" library
/// many ESP32/ESP8266 sketches use) print `ls -l`-*like* LIST lines that
/// suppaftp's strict parser rejects outright: fields separated by tabs
/// instead of spaces, and — the part that actually breaks the regex — only
/// one owner-ish identity column instead of real `ls -l`'s user *and*
/// group. suppaftp's own `parse_posix`/`parse_dos` always run first (real
/// servers still get their real timestamps parsed by those); this only
/// kicks in once both have already failed. Only name/type/size are pulled
/// out — the date field is matched but discarded, so `modified_ms` falls
/// back to 0 here, same as any other line whose timestamp isn't usable.
static EMBEDDED_LS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^([\-ld])[\-rwxsStT]{9}[ \t]+\d+[ \t]+(?:\S+[ \t]+){1,2}(\d+)[ \t]+\S+[ \t]+\d{1,2}[ \t]+(?:\d{1,2}:\d{1,2}|\d{4})[ \t]+(.+)$",
    )
    .unwrap()
});

// `path` is left empty here — these parsers only see one LIST line at a
// time, with no idea what directory produced it. `list()` fills it in
// afterward via `join_ftp_path`, once for the whole listing.
fn parse_embedded_ls_line(line: &str) -> Option<FtpEntry> {
    let captures = EMBEDDED_LS_RE.captures(line.trim_end())?;
    let is_dir = &captures[1] == "d";
    let size: u64 = captures[2].parse().ok()?;
    let name = captures[3].to_string();
    Some(FtpEntry {
        name,
        path: String::new(),
        is_dir,
        size,
        modified_ms: 0,
    })
}

fn parse_list_line(line: &str) -> Option<FtpEntry> {
    if let Ok(file) = ListParser::parse_posix(line).or_else(|_| ListParser::parse_dos(line)) {
        let modified_ms = file
            .modified()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        return Some(FtpEntry {
            name: file.name().to_string(),
            path: String::new(),
            is_dir: file.is_directory(),
            size: file.size() as u64,
            modified_ms,
        });
    }
    parse_embedded_ls_line(line)
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
        let addr = (host, port)
            .to_socket_addrs()
            .map_err(|e| format!("failed to resolve {host}:{port}: {e}"))?
            .next()
            .ok_or_else(|| format!("failed to resolve {host}:{port}"))?;
        let mut stream = FtpStream::connect_timeout(addr, CONNECT_TIMEOUT)
            .map_err(|e| format!("failed to connect: {e}"))?;
        stream
            .get_ref()
            .set_read_timeout(Some(IO_TIMEOUT))
            .map_err(|e| format!("failed to set read timeout: {e}"))?;
        stream
            .get_ref()
            .set_write_timeout(Some(IO_TIMEOUT))
            .map_err(|e| format!("failed to set write timeout: {e}"))?;
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
        // An empty path (the frontend's root-node sentinel) lists whatever
        // the session's current directory already is. A non-empty path
        // can't just be passed as `LIST <path>`'s argument — plenty of
        // minimal embedded FTP servers accept that argument but silently
        // ignore it and list the CWD regardless, which (since nothing here
        // ever CWDs) made every tree node show the *root's* own children
        // over and over, however deep it was expanded. CWD-ing there and
        // back instead is universally supported: the whole sequence runs
        // under one `with_session` lock, so it's atomic with respect to any
        // other tab/request touching this same session, and the original
        // cwd is restored afterward so a later root refresh's own `pwd()`
        // isn't left pointing at the last-expanded subfolder.
        let resolved = if path.is_empty() {
            self.pwd(id)?
        } else {
            path.to_string()
        };
        let path = path.to_string();
        let lines = self.with_session(id, |s| {
            if path.is_empty() {
                s.list(None)
            } else {
                let original = s.pwd()?;
                s.cwd(&path)?;
                let result = s.list(None);
                let _ = s.cwd(&original);
                result
            }
        })?;
        Ok(lines
            .iter()
            .filter_map(|line| parse_list_line(line))
            .map(|entry| FtpEntry {
                path: join_ftp_path(&resolved, &entry.name),
                ..entry
            })
            .collect())
    }

    pub fn read_file(&self, id: &str, path: &str) -> Result<Vec<u8>, String> {
        let cursor = self.with_session(id, |s| s.retr_as_buffer(path))?;
        Ok(cursor.into_inner())
    }

    /// Writes `content`, creating the file if absent and truncating it if
    /// present — `put_file` sends a `STOR`, which per the FTP protocol
    /// itself always replaces the target file wholesale, so (unlike SFTP's
    /// `write_file`) there's no separate "must use create, not write" trap
    /// to avoid here.
    pub fn write_file(&self, id: &str, path: &str, content: &[u8]) -> Result<(), String> {
        let mut cursor = Cursor::new(content.to_vec());
        self.with_session(id, |s| s.put_file(path, &mut cursor).map(|_| ()))
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

    /// Downloads in chunks (rather than `read_file`'s whole-file-into-memory
    /// shot) so `on_progress(bytes_so_far, total_bytes)` can report progress
    /// for a large transfer instead of the caller only finding out once the
    /// entire thing has already completed — same shape as `sftp::client`'s
    /// `download`. `SIZE` is queried first since it's a control-channel
    /// command and must complete before `RETR` opens the data connection.
    pub fn download(
        &self,
        id: &str,
        remote_path: &str,
        local_path: &str,
        mut on_progress: impl FnMut(u64, u64) + Send,
    ) -> Result<(), String> {
        let mut local_file = std::fs::File::create(local_path)
            .map_err(|e| format!("failed to write {local_path}: {e}"))?;
        self.with_session(id, |s| {
            let total = s.size(remote_path).unwrap_or(0) as u64;
            let mut stream = s.retr_as_stream(remote_path)?;
            let mut buf = vec![0u8; TRANSFER_CHUNK_SIZE];
            let mut transferred: u64 = 0;
            loop {
                let n = stream.read(&mut buf).map_err(FtpError::ConnectionError)?;
                if n == 0 {
                    break;
                }
                local_file
                    .write_all(&buf[..n])
                    .map_err(FtpError::ConnectionError)?;
                transferred += n as u64;
                on_progress(transferred, total);
            }
            s.finalize_retr_stream(stream)
        })
    }

    /// Same chunked-with-progress shape as `download`.
    pub fn upload(
        &self,
        id: &str,
        local_path: &str,
        remote_path: &str,
        mut on_progress: impl FnMut(u64, u64) + Send,
    ) -> Result<(), String> {
        let mut local_file = std::fs::File::open(local_path)
            .map_err(|e| format!("failed to read {local_path}: {e}"))?;
        let total = local_file.metadata().map(|m| m.len()).unwrap_or(0);
        self.with_session(id, |s| {
            let mut stream = s.put_with_stream(remote_path)?;
            let mut buf = vec![0u8; TRANSFER_CHUNK_SIZE];
            let mut transferred: u64 = 0;
            loop {
                let n = local_file
                    .read(&mut buf)
                    .map_err(FtpError::ConnectionError)?;
                if n == 0 {
                    break;
                }
                stream
                    .write_all(&buf[..n])
                    .map_err(FtpError::ConnectionError)?;
                transferred += n as u64;
                on_progress(transferred, total);
            }
            s.finalize_put_stream(stream)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Regression coverage for the "FTP shows an empty directory against my
    // ESP32" report: the Arduino SimpleFTPServer library (a common ESP32/
    // ESP8266 FTP server) emits tab-separated LIST lines with a single
    // owner column instead of real `ls -l`'s user+group pair, which
    // suppaftp's strict regex rejects outright — see `EMBEDDED_LS_RE`.
    #[test]
    fn parses_embedded_server_directory_line() {
        let entry = parse_list_line("drwxrwsr-x\t2\tftp\t4096\tMay 17 12:34\tfoldername").unwrap();
        assert_eq!(entry.name, "foldername");
        assert!(entry.is_dir);
    }

    #[test]
    fn parses_embedded_server_file_line() {
        let entry =
            parse_list_line("-rw-rw-r--\t1\tftp\t875315\tMar 23 17:29\tsomefile.txt").unwrap();
        assert_eq!(entry.name, "somefile.txt");
        assert!(!entry.is_dir);
        assert_eq!(entry.size, 875315);
    }

    // Same single-owner-column format but space-separated (not every
    // embedded server uses tabs) and with a 4-digit year instead of a
    // current-year HH:MM time.
    #[test]
    fn parses_embedded_server_line_with_year_and_spaces() {
        let entry = parse_list_line("-rw-rw-r-- 1 ftp 42 Jan 1 2019 old.bin").unwrap();
        assert_eq!(entry.name, "old.bin");
        assert_eq!(entry.size, 42);
    }

    // A normal two-identity-column `ls -l` line (real user *and* group)
    // must still parse via suppaftp's own parser, not the fallback.
    #[test]
    fn parses_standard_posix_line() {
        let entry = parse_list_line("-rw-r--r-- 1 user group 1234 Nov 5 13:46 example.txt")
            .expect("standard posix line should still parse");
        assert_eq!(entry.name, "example.txt");
        assert_eq!(entry.size, 1234);
    }

    #[test]
    fn rejects_garbage_line() {
        assert!(parse_list_line("total 12").is_none());
        assert!(parse_list_line("").is_none());
    }

    #[test]
    fn joins_ftp_paths() {
        assert_eq!(join_ftp_path("/", "file.txt"), "/file.txt");
        assert_eq!(join_ftp_path("/home/user", "docs"), "/home/user/docs");
        assert_eq!(join_ftp_path("/home/user/", "docs"), "/home/user/docs");
    }

    #[test]
    fn list_on_unknown_session_errors() {
        let manager = FtpManager::new();
        let err = manager.list("nope", "/").unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[test]
    fn read_file_on_unknown_session_errors() {
        let manager = FtpManager::new();
        let err = manager.read_file("nope", "/x").unwrap_err();
        assert!(err.contains("connect first"));
    }

    #[test]
    fn write_file_on_unknown_session_errors() {
        let manager = FtpManager::new();
        let err = manager.write_file("nope", "/x", b"hi").unwrap_err();
        assert!(err.contains("connect first"));
    }
}
