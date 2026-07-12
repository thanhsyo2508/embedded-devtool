import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToastStore } from '../state/toastStore'
import { BellIcon, TrashIcon } from './icons'

function formatTime(atMs: number): string {
  return new Date(atMs).toLocaleTimeString()
}

/** Live toasts (ToastStack) auto-dismiss after 6s and are gone — this is
 * the "read it again" surface: a bell + unread dot in the top bar opening
 * a dropdown of every toast shown this session (persisted across
 * restarts, capped at 50). */
export function NotificationBell() {
  const { t } = useTranslation()
  const history = useToastStore((s) => s.history)
  const lastViewedAtMs = useToastStore((s) => s.lastViewedAtMs)
  const clearHistory = useToastStore((s) => s.clearHistory)
  const markViewed = useToastStore((s) => s.markViewed)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const hasUnread = history.some((h) => h.atMs > lastViewedAtMs)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const handleToggle = () => {
    setOpen((v) => !v)
    if (!open) markViewed()
  }

  return (
    <div className="notification-bell" ref={containerRef}>
      <button
        type="button"
        className={`icon-button settings-trigger ${open ? 'on' : ''}`}
        aria-label={t('notifications.title')}
        title={t('notifications.title')}
        onClick={handleToggle}
      >
        <BellIcon />
        {hasUnread && <span className="notification-dot" />}
      </button>
      {open && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-header">
            <span>{t('notifications.title')}</span>
            <button
              type="button"
              className="icon-button"
              aria-label={t('notifications.clear')}
              title={t('notifications.clear')}
              disabled={history.length === 0}
              onClick={() => clearHistory()}
            >
              <TrashIcon />
            </button>
          </div>
          <div className="notification-dropdown-list">
            {history.length === 0 && (
              <p className="notification-empty">{t('notifications.empty')}</p>
            )}
            {history.map((entry) => (
              <div key={entry.id} className={`notification-entry notification-${entry.kind}`}>
                <span className="notification-time">{formatTime(entry.atMs)}</span>
                <span>{entry.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
