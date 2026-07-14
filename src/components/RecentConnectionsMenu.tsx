import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRecentConnectionsStore, type RecentConnection } from '../state/recentConnectionsStore'
import { ClockIcon, TrashIcon } from './icons'

function formatRelativeTime(
  t: (key: string, opts?: Record<string, number>) => string,
  atMs: number,
): string {
  const seconds = Math.max(0, Math.round((Date.now() - atMs) / 1000))
  if (seconds < 60) return t('connect.recentJustNow')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t('connect.recentMinutesAgo', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('connect.recentHoursAgo', { count: hours })
  return t('connect.recentDaysAgo', { count: Math.round(hours / 24) })
}

/** Recent connections used to be an always-visible list inside ConnectPanel,
 * eating into the connect form's space even when the user just wants to
 * pick a protocol and fill in fresh details — moved to a topbar dropdown
 * (same click-outside-to-close pattern as NotificationBell) instead.
 * Picking an entry here reconnects immediately via `onReconnect` (the same
 * logic the command palette's "Reconnect: X" entries already use), it
 * doesn't just prefill the connect form. */
export function RecentConnectionsMenu({
  onReconnect,
}: {
  onReconnect: (recent: RecentConnection) => void
}) {
  const { t } = useTranslation()
  const items = useRecentConnectionsStore((s) => s.items)
  const removeRecentConnection = useRecentConnectionsStore((s) => s.remove)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

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

  return (
    <div className="notification-bell" ref={containerRef}>
      <button
        type="button"
        className={`icon-button settings-trigger ${open ? 'on' : ''}`}
        aria-label={t('connect.recentLabel')}
        title={t('connect.recentLabel')}
        onClick={() => setOpen((v) => !v)}
      >
        <ClockIcon />
      </button>
      {open && (
        <div className="notification-dropdown recent-connections-dropdown">
          <div className="notification-dropdown-header">
            <span>{t('connect.recentLabel')}</span>
          </div>
          <div className="notification-dropdown-list">
            {items.length === 0 && <p className="notification-empty">{t('connect.recentEmpty')}</p>}
            {items.map((recent) => (
              <div key={recent.id} className="recent-connection-chip">
                <button
                  type="button"
                  className="recent-connection-main"
                  title={t('connect.recentApply')}
                  onClick={() => {
                    setOpen(false)
                    onReconnect(recent)
                  }}
                >
                  <span className="recent-connection-label">{recent.label}</span>
                  <span className="recent-connection-time">
                    {formatRelativeTime(t, recent.connectedAtMs)}
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('common.delete')}
                  title={t('common.delete')}
                  onClick={() => removeRecentConnection(recent.id)}
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
