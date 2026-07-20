//! Shared SSH authentication for `core::ssh_stream` and `sftp::client`,
//! which each open their own independent `russh` connection (see both
//! modules' own doc comments for why) but need the exact same
//! password-or-private-key auth logic — kept here once instead of
//! duplicated in both.

use std::sync::Arc;

use russh::client;
use russh::keys::{PrivateKey, PrivateKeyWithHashAlg};

#[derive(Debug, Clone)]
pub enum SshAuth {
    Password(String),
    /// `passphrase` is `None`/empty for an unencrypted key. RSA keys sign
    /// with `PrivateKeyWithHashAlg::new(..., None)`, which maps to the
    /// legacy SHA-1 `ssh-rsa` algorithm rather than the newer
    /// `rsa-sha2-256`/`512` — the simpler, universally-accepted default
    /// for a first cut of key auth rather than negotiating the server's
    /// preferred hash.
    PrivateKey {
        path: String,
        passphrase: Option<String>,
    },
}

pub async fn authenticate<H: client::Handler>(
    session: &mut client::Handle<H>,
    username: &str,
    auth: &SshAuth,
) -> Result<(), String> {
    match auth {
        SshAuth::Password(password) => {
            match session.authenticate_password(username, password).await {
                Ok(result) if result.success() => Ok(()),
                Ok(_) => Err("authentication failed".to_string()),
                Err(e) => Err(e.to_string()),
            }
        }
        SshAuth::PrivateKey { path, passphrase } => {
            let key_bytes = tokio::fs::read(path)
                .await
                .map_err(|e| format!("failed to read private key '{path}': {e}"))?;
            let mut private_key = PrivateKey::from_openssh(&key_bytes)
                .map_err(|e| format!("invalid private key: {e}"))?;
            if private_key.is_encrypted() {
                let pass = passphrase.as_deref().unwrap_or("");
                private_key = private_key
                    .decrypt(pass)
                    .map_err(|_| "wrong passphrase for private key".to_string())?;
            }
            let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(private_key), None);
            match session
                .authenticate_publickey(username, key_with_hash)
                .await
            {
                Ok(result) if result.success() => Ok(()),
                Ok(_) => Err("authentication failed".to_string()),
                Err(e) => Err(e.to_string()),
            }
        }
    }
}
