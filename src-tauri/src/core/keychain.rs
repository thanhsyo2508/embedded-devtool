//! Thin wrapper over the OS-native credential store (Windows Credential
//! Manager / macOS Keychain / Linux Secret Service via `keyring`'s `v1`
//! compat API) -- backs the opt-in "remember this password" toggle on
//! SSH/network connections. Everything else in this app that looks like a
//! saved password (connection profiles, project files) stores it in-memory
//! or in the frontend's local storage; this is the one path that persists
//! a secret to a place the OS itself protects, for users who explicitly
//! ask for it.
//!
//! One `Entry` per call rather than a cached/shared one -- `keyring::Entry`
//! is cheap to construct and each of the handful of calls this app makes
//! is already off the UI thread (a Tauri command), so there's no
//! performance reason to hold one open.

const SERVICE: &str = "dev.edt.embedded-devtool";

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
}

/// Saves `password` under `key` (a caller-chosen stable identifier for the
/// connection, e.g. `ssh://user@host:port`) in the OS credential store.
pub fn save_password(key: &str, password: &str) -> Result<(), String> {
    entry(key)?
        .set_password(password)
        .map_err(|e| e.to_string())
}

/// Returns `Ok(None)` (not an error) when nothing has been saved under
/// `key` yet -- the common case for a connection that was never opted in.
pub fn load_password(key: &str) -> Result<Option<String>, String> {
    match entry(key)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Removes a saved password, e.g. when the user turns "remember password"
/// back off. Not an error if nothing was saved.
pub fn delete_password(key: &str) -> Result<(), String> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
