import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useTranslation } from 'react-i18next'
import {
  MAX_LINES_OPTIONS,
  PLOT_MAX_POINTS_OPTIONS,
  useSettingsStore,
  type Encoding,
  type FontSize,
  type Language,
  type NewlineMode,
  type Theme,
} from '../state/settingsStore'
import { useUpdateStore } from '../state/updateStore'
import { BookOpenIcon, GearIcon, MessageIcon, RefreshIcon, XIcon } from './icons'
import { HelpGuide } from './HelpGuide'

const REPO_URL = 'https://github.com/thanhsyo2508/embedded-devtool'

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const settings = useSettingsStore()
  const [showGuide, setShowGuide] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const updateStatus = useUpdateStore((s) => s.status)
  const updateVersion = useUpdateStore((s) => s.version)
  const updateBody = useUpdateStore((s) => s.body)
  const updateProgress = useUpdateStore((s) => s.progress)
  const updateError = useUpdateStore((s) => s.error)
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate)
  const installAndRelaunch = useUpdateStore((s) => s.installAndRelaunch)

  useEffect(() => {
    void getVersion().then(setAppVersion)
  }, [])

  const handleKeepAwakeChange = (checked: boolean) => {
    settings.setKeepAwake(checked)
    void invoke('set_keep_awake', { enabled: checked }).catch(() => {
      // best-effort — not every OS/build supports every inhibition mode
    })
  }

  // M3-T2.8: prefills the GitHub issue form's `version`/`os` fields (matched
  // by their form field ids) via query params, so a report already carries
  // the info a maintainer would otherwise have to ask for.
  const handleSendFeedback = async () => {
    const version = await getVersion().catch(() => 'unknown')
    const params = new URLSearchParams({
      template: 'bug_report.yml',
      version,
      os: navigator.userAgent,
    })
    void openUrl(`${REPO_URL}/issues/new?${params.toString()}`)
  }

  const shortcuts: [string, string][] = [
    ['Ctrl+N', t('settings.shortcuts.newConnection')],
    ['Ctrl+W', t('settings.shortcuts.closeTab')],
    ['Ctrl+1–9', t('settings.shortcuts.switchTab')],
    ['Ctrl+L', t('settings.shortcuts.clearTab')],
    ['Ctrl+F', t('settings.shortcuts.searchBuffer')],
    ['Space', t('settings.shortcuts.pauseResume')],
    ['Ctrl+Shift+P', t('settings.shortcuts.togglePlotter')],
    ['Ctrl+Shift+F', t('settings.shortcuts.toggleFlashPanel')],
    ['Ctrl+,', t('settings.shortcuts.toggleSettings')],
    ['Esc', t('settings.shortcuts.closeSettingsFlash')],
  ]

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">
            <GearIcon /> {t('settings.title')}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('settings.closeAriaLabel')}
            onClick={onClose}
          >
            <XIcon />
          </button>
        </div>

        <div className="settings-row">
          <span>{t('settings.language')}</span>
          <select
            value={settings.language}
            onChange={(e) => settings.setLanguage(e.target.value as Language)}
          >
            <option value="en">{t('settings.languageEnglish')}</option>
            <option value="vi">{t('settings.languageVietnamese')}</option>
          </select>
        </div>

        <div className="settings-row">
          <span>{t('settings.encoding')}</span>
          <select
            value={settings.encoding}
            onChange={(e) => settings.setEncoding(e.target.value as Encoding)}
          >
            <option value="utf-8">UTF-8</option>
            <option value="ascii">ASCII</option>
          </select>
        </div>

        <div className="settings-row">
          <span>{t('settings.bufferSizeLines')}</span>
          <select
            value={settings.maxLinesPerTab}
            onChange={(e) => settings.setMaxLinesPerTab(Number(e.target.value))}
          >
            {MAX_LINES_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-row">
          <span>{t('settings.bufferSizePlotter')}</span>
          <select
            value={settings.plotMaxPoints}
            onChange={(e) => settings.setPlotMaxPoints(Number(e.target.value))}
          >
            {PLOT_MAX_POINTS_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-row">
          <span>{t('settings.newline')}</span>
          <div className="seg">
            {(['crlf', 'cr', 'lf'] as NewlineMode[]).map((mode) => (
              <span
                key={mode}
                className={settings.newline === mode ? 'on' : ''}
                onClick={() => settings.setNewline(mode)}
              >
                {mode === 'crlf' ? '\\r\\n' : mode === 'cr' ? '\\r' : '\\n'}
              </span>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <span>{t('settings.fontSize')}</span>
          <div className="seg">
            {(['small', 'medium', 'large'] as FontSize[]).map((size) => (
              <span
                key={size}
                className={settings.fontSize === size ? 'on' : ''}
                onClick={() => settings.setFontSize(size)}
              >
                A
              </span>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <span>{t('settings.keepAwake')}</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={settings.keepAwake}
              onChange={(e) => handleKeepAwakeChange(e.target.checked)}
            />
            <span className="switch-track" />
          </label>
        </div>

        <hr className="settings-divider" />

        <div className="settings-row">
          <span>{t('settings.personalization')}</span>
          <div className="seg">
            {(['system', 'dark', 'light'] as Theme[]).map((theme) => (
              <span
                key={theme}
                className={settings.theme === theme ? 'on' : ''}
                onClick={() => settings.setTheme(theme)}
              >
                {t(`settings.theme.${theme}`)}
              </span>
            ))}
          </div>
        </div>

        <hr className="settings-divider" />

        <div className="settings-row">
          <span>{t('settings.feedback')}</span>
          <button
            type="button"
            className="feedback-button"
            onClick={() => void handleSendFeedback()}
          >
            <MessageIcon /> {t('settings.sendFeedback')}
          </button>
        </div>

        <hr className="settings-divider" />

        <div className="settings-row">
          <span>{t('settings.userGuide')}</span>
          <button type="button" className="feedback-button" onClick={() => setShowGuide(true)}>
            <BookOpenIcon /> {t('settings.openGuide')}
          </button>
        </div>

        <hr className="settings-divider" />

        <div className="settings-row">
          <span>{t('settings.appVersion')}</span>
          <span className="mono">{appVersion ?? '…'}</span>
        </div>
        <div className="settings-row">
          <span>
            {updateStatus === 'checking'
              ? t('settings.update.checking')
              : updateStatus === 'up-to-date'
                ? t('settings.update.upToDate')
                : updateStatus === 'available'
                  ? t('settings.update.available', { version: updateVersion })
                  : updateStatus === 'downloading'
                    ? t('settings.update.downloading', { progress: updateProgress })
                    : updateStatus === 'ready'
                      ? t('settings.update.restarting')
                      : t('settings.update.title')}
          </span>
          <button
            type="button"
            className="feedback-button"
            disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
            onClick={() => void checkForUpdate()}
          >
            <RefreshIcon /> {t('settings.update.checkForUpdates')}
          </button>
        </div>
        {updateStatus === 'available' && (
          <>
            {updateBody && <p className="update-notes">{updateBody}</p>}
            <button
              type="button"
              className="connect-button"
              onClick={() => void installAndRelaunch()}
            >
              {t('settings.update.installAndRestart')}
            </button>
          </>
        )}
        {updateStatus === 'error' && <p className="connect-error">{updateError}</p>}

        <hr className="settings-divider" />

        <div className="shortcuts-list">
          <div className="shortcuts-title">{t('settings.shortcutsTitle')}</div>
          {shortcuts.map(([keys, label]) => (
            <div key={keys} className="shortcut-row">
              <kbd>{keys}</kbd>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
      {showGuide && <HelpGuide onClose={() => setShowGuide(false)} />}
    </div>
  )
}
