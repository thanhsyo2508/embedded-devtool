import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { SHORTCUTS } from '../lib/shortcuts'
import { XIcon } from './icons'

/** The `?` cheat-sheet — a quick keyboard-shortcut reference reachable
 * without opening Settings, sharing the same SHORTCUTS list so the two can
 * never drift apart. */
export function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="shortcut-overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">{t('shortcutOverlay.title')}</span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <XIcon />
          </button>
        </div>
        <div className="shortcut-overlay-grid">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="shortcut-row">
              <kbd>{shortcut.keys}</kbd>
              <span>{t(shortcut.labelKey)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
