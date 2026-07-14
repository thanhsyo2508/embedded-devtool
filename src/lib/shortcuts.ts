/** Single source of truth for the app's keyboard shortcuts, consumed by
 * both the Settings panel's reference list and the `?` overlay — keeping
 * them in one place is why the Settings list previously went stale (it was
 * hand-maintained and missed newly added shortcuts like global search).
 *
 * `keys` is the display string; `labelKey` is an i18n key under
 * `settings.shortcuts.*`. Order here is the order shown. */
export interface ShortcutEntry {
  keys: string
  labelKey: string
}

export const SHORTCUTS: ShortcutEntry[] = [
  { keys: 'Ctrl+K', labelKey: 'settings.shortcuts.commandPalette' },
  { keys: 'Ctrl+N', labelKey: 'settings.shortcuts.newConnection' },
  { keys: 'Ctrl+W', labelKey: 'settings.shortcuts.closeTab' },
  { keys: 'Ctrl+1–9', labelKey: 'settings.shortcuts.switchTab' },
  { keys: 'Ctrl+L', labelKey: 'settings.shortcuts.clearTab' },
  { keys: 'Ctrl+F', labelKey: 'settings.shortcuts.searchBuffer' },
  { keys: 'Ctrl+Shift+G', labelKey: 'settings.shortcuts.globalSearch' },
  { keys: 'Space', labelKey: 'settings.shortcuts.pauseResume' },
  { keys: 'Ctrl+Shift+P', labelKey: 'settings.shortcuts.togglePlotter' },
  { keys: 'Ctrl+Shift+F', labelKey: 'settings.shortcuts.toggleFlashPanel' },
  { keys: 'Ctrl+,', labelKey: 'settings.shortcuts.toggleSettings' },
  { keys: '?', labelKey: 'settings.shortcuts.showShortcuts' },
  { keys: 'Esc', labelKey: 'settings.shortcuts.closeSettingsFlash' },
]
