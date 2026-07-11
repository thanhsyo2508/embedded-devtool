import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TabState } from '../state/tabsStore'

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

// Rates aren't stored in the tab state — they're derived here by sampling
// the cumulative counters once a second, so nothing needs to recompute on
// every single incoming batch.
export function StatsBar({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const [stats, setStats] = useState({ bytesPerSec: 0, linesPerSec: 0, uptimeMs: 0 })
  const prevRef = useRef({ bytes: tab.totalBytesReceived, lines: tab.totalLinesReceived })

  useEffect(() => {
    const interval = setInterval(() => {
      const prev = prevRef.current
      setStats({
        bytesPerSec: tab.totalBytesReceived - prev.bytes,
        linesPerSec: tab.totalLinesReceived - prev.lines,
        uptimeMs: Date.now() - tab.connectedAtMs,
      })
      prevRef.current = { bytes: tab.totalBytesReceived, lines: tab.totalLinesReceived }
    }, 1000)
    return () => clearInterval(interval)
  }, [tab.totalBytesReceived, tab.totalLinesReceived, tab.connectedAtMs])

  return (
    <div className="stats-bar">
      <span>{t('statsBar.bytesPerSec', { count: stats.bytesPerSec.toLocaleString() })}</span>
      <span>{t('statsBar.linesPerSec', { count: stats.linesPerSec.toLocaleString() })}</span>
      <span className={tab.errorCount > 0 ? 'stat-error' : ''}>
        {t('statsBar.errors', { count: tab.errorCount })}
      </span>
      <span>{t('statsBar.uptime', { time: formatUptime(stats.uptimeMs) })}</span>
    </div>
  )
}
