//! Local FTP server (RFC 959) via `libunftp` + `unftp-sbe-fs`'s filesystem
//! storage backend. Runs on its own dedicated OS thread with its own
//! current-thread tokio runtime — same pattern as the SSH client in
//! `core/ssh_stream.rs` — rather than a shared global runtime, since this
//! is the only other place in the app that needs async I/O.

use std::path::PathBuf;
use std::sync::mpsc as std_mpsc;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use async_trait::async_trait;
use libunftp::auth::AnonymousAuthenticator;
use libunftp::ServerBuilder;
use tokio::sync::oneshot;
use unftp_core::auth::{AuthenticationError, Authenticator, Credentials, Principal};
use unftp_sbe_fs::Filesystem;

const READY_TIMEOUT: Duration = Duration::from_secs(5);
// A modest range, not the huge default span — this app runs on a
// developer's LAN, not behind a firewall that needs a wide passive-port
// allowance opened for it.
const PASSIVE_PORTS: std::ops::RangeInclusive<u16> = 50_000..=50_050;

#[derive(Debug)]
struct FixedCredentialsAuthenticator {
    username: String,
    password: String,
}

#[async_trait]
impl Authenticator for FixedCredentialsAuthenticator {
    async fn authenticate(
        &self,
        username: &str,
        creds: &Credentials,
    ) -> Result<Principal, AuthenticationError> {
        let provided_password = creds.password.as_deref().unwrap_or("");
        if username == self.username && provided_password == self.password {
            Ok(Principal {
                username: username.to_string(),
            })
        } else {
            Err(AuthenticationError::BadPassword)
        }
    }
}

struct RunningServer {
    shutdown_tx: oneshot::Sender<()>,
    thread: JoinHandle<()>,
}

#[derive(Default)]
pub struct FtpServerManager {
    running: Mutex<Option<RunningServer>>,
}

impl FtpServerManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_running(&self) -> bool {
        self.running.lock().unwrap().is_some()
    }

    /// Starts the server on its own thread+runtime and blocks (briefly)
    /// until it's confirmed either listening or failed to start, so the
    /// caller gets an immediate, honest success/failure result instead of
    /// finding out about a bad root directory or busy port asynchronously.
    pub fn start(
        &self,
        root_dir: String,
        port: u16,
        username: Option<String>,
        password: Option<String>,
    ) -> Result<(), String> {
        let mut running = self.running.lock().unwrap();
        if running.is_some() {
            return Err("FTP server is already running".to_string());
        }

        let root = PathBuf::from(&root_dir);
        if !root.is_dir() {
            return Err(format!("{root_dir} is not a directory"));
        }

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let (ready_tx, ready_rx) = std_mpsc::channel::<Result<(), String>>();

        let thread = thread::spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    let _ = ready_tx.send(Err(e.to_string()));
                    return;
                }
            };

            runtime.block_on(async move {
                let root_for_gen = root.clone();
                let authenticator: Arc<dyn Authenticator + Send + Sync> = match (username, password)
                {
                    (Some(u), Some(p)) if !u.is_empty() => {
                        Arc::new(FixedCredentialsAuthenticator {
                            username: u,
                            password: p,
                        })
                    }
                    _ => Arc::new(AnonymousAuthenticator {}),
                };

                let server = ServerBuilder::with_authenticator(
                    Box::new(move || Filesystem::new(root_for_gen.clone()).unwrap()),
                    authenticator,
                )
                .greeting("Welcome to the EDT FTP server")
                .passive_ports(PASSIVE_PORTS)
                .shutdown_indicator(async move {
                    let _ = shutdown_rx.await;
                    libunftp::options::Shutdown::new()
                })
                .build();

                let server = match server {
                    Ok(s) => s,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e.to_string()));
                        return;
                    }
                };

                let _ = ready_tx.send(Ok(()));
                if let Err(e) = server.listen(format!("0.0.0.0:{port}")).await {
                    eprintln!("FTP server stopped: {e}");
                }
            });
        });

        match ready_rx.recv_timeout(READY_TIMEOUT) {
            Ok(Ok(())) => {
                *running = Some(RunningServer {
                    shutdown_tx,
                    thread,
                });
                Ok(())
            }
            Ok(Err(e)) => Err(e),
            Err(_) => Err("timed out starting the FTP server".to_string()),
        }
    }

    pub fn stop(&self) {
        let running = self.running.lock().unwrap().take();
        if let Some(server) = running {
            let _ = server.shutdown_tx.send(());
            let _ = server.thread.join();
        }
    }
}
