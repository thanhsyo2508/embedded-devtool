//! SSH client `DataStream` implementation — a real interactive PTY shell,
//! not the line-oriented text monitor every other transport here feeds.
//! Uses `russh` (pure Rust, no OpenSSL/libssh2 system dependency, unlike
//! the more common `ssh2` crate) even though it's async/tokio-based,
//! wrapping it in a dedicated OS thread running its own single-threaded
//! tokio runtime — the same shape `MqttStream` uses to wrap rumqttc's
//! tokio internals behind a blocking `DataStream`.
//!
//! Output is raw bytes including ANSI escape codes, meant to be rendered
//! by a real terminal emulator (xterm.js) on the frontend — it still goes
//! through the same ring-buffer/batch-emit pipeline every other transport
//! uses (the 60fps batching doesn't corrupt binary terminal data), but the
//! frontend must not run it through the newline-splitting logic the
//! generic line monitor uses.
//!
//! Host key verification uses `core::known_hosts`'s trust-on-first-use
//! store — the first connection to a given host:port is trusted
//! automatically (no interactive prompt; see that module's doc comment for
//! why), but a later connection presenting a *different* key is refused.

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crossbeam_channel::{unbounded, Receiver, Sender};
use russh::client::{self};
use russh::{ChannelMsg, Disconnect};
use tokio::sync::mpsc;

use super::data_stream::{DataCallback, DataStream};
use super::known_hosts::{self, KnownHosts};
use super::ring_buffer::RingBuffer;
use super::ssh_auth::{self, SshAuth};
use super::stream_pump::spawn_pump_thread;

const RING_BUFFER_CAPACITY: usize = 1 << 20;
const DEFAULT_COLS: u32 = 80;
const DEFAULT_ROWS: u32 = 24;
/// How long `open()` blocks waiting for connect+auth+PTY+shell to finish
/// before giving up — matches the MQTT connect-verification pattern (a bad
/// host/port/credentials should surface as a real error, not a tab that
/// silently never receives anything).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

struct SshHandler {
    known_hosts: Arc<KnownHosts>,
    host: String,
    port: u16,
}

impl client::Handler for SshHandler {
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

enum SshCommand {
    Data(Vec<u8>),
    Resize(u32, u32),
}

pub struct SshStream {
    host: String,
    port: u16,
    username: String,
    auth: SshAuth,
    known_hosts: Arc<KnownHosts>,
    cmd_tx: Option<mpsc::UnboundedSender<SshCommand>>,
    worker_thread: Option<JoinHandle<()>>,
    pump_thread: Option<JoinHandle<()>>,
    stop_flag: Arc<AtomicBool>,
    connection_lost: Arc<AtomicBool>,
    buffer: Arc<Mutex<RingBuffer>>,
    callbacks: Arc<Mutex<Vec<DataCallback>>>,
}

impl SshStream {
    pub fn new(
        host: String,
        port: u16,
        username: String,
        auth: SshAuth,
        known_hosts: Arc<KnownHosts>,
    ) -> Self {
        Self {
            host,
            port,
            username,
            auth,
            known_hosts,
            cmd_tx: None,
            worker_thread: None,
            pump_thread: None,
            stop_flag: Arc::new(AtomicBool::new(false)),
            connection_lost: Arc::new(AtomicBool::new(false)),
            buffer: Arc::new(Mutex::new(RingBuffer::new(RING_BUFFER_CAPACITY))),
            callbacks: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl DataStream for SshStream {
    fn open(&mut self) -> io::Result<()> {
        if self.cmd_tx.is_some() {
            return Ok(());
        }

        let (data_tx, data_rx): (Sender<Vec<u8>>, Receiver<Vec<u8>>) = unbounded();
        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<SshCommand>();
        let (ready_tx, ready_rx) = unbounded::<Result<(), String>>();

        self.stop_flag.store(false, Ordering::SeqCst);
        self.connection_lost.store(false, Ordering::SeqCst);
        let stop_flag = self.stop_flag.clone();
        let connection_lost = self.connection_lost.clone();
        let host = self.host.clone();
        let port = self.port;
        let username = self.username.clone();
        let auth = self.auth.clone();
        let known_hosts = self.known_hosts.clone();

        self.worker_thread = Some(thread::spawn(move || {
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
                let config = Arc::new(client::Config::default());
                let handler = SshHandler {
                    known_hosts,
                    host: host.clone(),
                    port,
                };
                let mut session =
                    match client::connect(config, (host.as_str(), port), handler).await {
                        Ok(s) => s,
                        Err(e) => {
                            let _ = ready_tx.send(Err(e.to_string()));
                            return;
                        }
                    };

                if let Err(e) = ssh_auth::authenticate(&mut session, &username, &auth).await {
                    let _ = ready_tx.send(Err(e));
                    return;
                }

                let mut channel = match session.channel_open_session().await {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e.to_string()));
                        return;
                    }
                };

                if let Err(e) = channel
                    .request_pty(
                        false,
                        "xterm-256color",
                        DEFAULT_COLS,
                        DEFAULT_ROWS,
                        0,
                        0,
                        &[],
                    )
                    .await
                {
                    let _ = ready_tx.send(Err(e.to_string()));
                    return;
                }

                if let Err(e) = channel.request_shell(false).await {
                    let _ = ready_tx.send(Err(e.to_string()));
                    return;
                }

                let _ = ready_tx.send(Ok(()));

                loop {
                    if stop_flag.load(Ordering::Relaxed) {
                        break;
                    }
                    tokio::select! {
                        cmd = cmd_rx.recv() => {
                            match cmd {
                                Some(SshCommand::Data(bytes)) => {
                                    if channel.data_bytes(bytes).await.is_err() {
                                        break;
                                    }
                                }
                                Some(SshCommand::Resize(cols, rows)) => {
                                    let _ = channel.window_change(cols, rows, 0, 0).await;
                                }
                                None => break, // sender dropped (close() called), stream closing
                            }
                        }
                        msg = channel.wait() => {
                            match msg {
                                Some(ChannelMsg::Data { data })
                                | Some(ChannelMsg::ExtendedData { data, .. }) => {
                                    if data_tx.send(data.to_vec()).is_err() {
                                        break;
                                    }
                                }
                                Some(ChannelMsg::Eof)
                                | Some(ChannelMsg::Close)
                                | Some(ChannelMsg::ExitStatus { .. })
                                | None => {
                                    connection_lost.store(true, Ordering::SeqCst);
                                    break;
                                }
                                _ => {}
                            }
                        }
                    }
                }

                let _ = session
                    .disconnect(Disconnect::ByApplication, "", "English")
                    .await;
            });
        }));

        match ready_rx.recv_timeout(CONNECT_TIMEOUT) {
            Ok(Ok(())) => {}
            Ok(Err(message)) => return Err(io::Error::other(message)),
            Err(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "timed out waiting for the SSH session to become ready",
                ))
            }
        }

        self.pump_thread = Some(spawn_pump_thread(
            data_rx,
            self.buffer.clone(),
            self.callbacks.clone(),
        ));
        self.cmd_tx = Some(cmd_tx);
        Ok(())
    }

    fn close(&mut self) -> io::Result<()> {
        self.stop_flag.store(true, Ordering::SeqCst);
        // Dropping the sender is what actually wakes the worker's
        // `tokio::select!` loop promptly (an mpsc receiver resolves to
        // `None` as soon as every sender is gone) -- the stop_flag check
        // alone wouldn't fire until the next unrelated event.
        self.cmd_tx = None;
        if let Some(handle) = self.worker_thread.take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.pump_thread.take() {
            let _ = handle.join();
        }
        Ok(())
    }

    fn read(&mut self) -> io::Result<Vec<u8>> {
        Ok(self.buffer.lock().unwrap().drain_all())
    }

    fn write(&mut self, data: &[u8]) -> io::Result<()> {
        match &self.cmd_tx {
            Some(tx) => tx
                .send(SshCommand::Data(data.to_vec()))
                .map_err(|_| io::Error::new(io::ErrorKind::NotConnected, "not connected")),
            None => Err(io::Error::new(io::ErrorKind::NotConnected, "not connected")),
        }
    }

    fn on_data(&mut self, callback: DataCallback) {
        self.callbacks.lock().unwrap().push(callback);
    }

    fn resize(&mut self, cols: u32, rows: u32) -> io::Result<()> {
        match &self.cmd_tx {
            Some(tx) => tx
                .send(SshCommand::Resize(cols, rows))
                .map_err(|_| io::Error::new(io::ErrorKind::NotConnected, "not connected")),
            None => Err(io::Error::new(io::ErrorKind::NotConnected, "not connected")),
        }
    }

    fn is_open(&self) -> bool {
        self.cmd_tx.is_some()
    }

    fn connection_lost(&self) -> bool {
        self.connection_lost.load(Ordering::Relaxed)
    }
}
