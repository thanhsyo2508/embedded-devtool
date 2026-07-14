import { invoke } from '@tauri-apps/api/core'

/** OS-native credential store (Windows Credential Manager / macOS Keychain
 * / Linux Secret Service) -- backs the opt-in "remember password" toggle
 * on SSH connections. `key` should be a stable per-connection identifier
 * (e.g. `ssh://user@host:port`), not the tab id (which changes every time
 * the same connection is reopened). */
export function keychainSavePassword(key: string, password: string): Promise<void> {
  return invoke('keychain_save_password', { key, password })
}

export function keychainLoadPassword(key: string): Promise<string | null> {
  return invoke('keychain_load_password', { key })
}

export function keychainDeletePassword(key: string): Promise<void> {
  return invoke('keychain_delete_password', { key })
}
