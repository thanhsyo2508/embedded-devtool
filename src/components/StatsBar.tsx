import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TabState } from '../state/tabsStore'

// Inter-line timing is measured over the last N lines only — enough to
// characterise the current cadence/jitter without scanning a 50k buffer on
// every render.
const TIMING_WINDOW = 200

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

  // Average / min / max gap between consecutive lines over the recent window,
  // for spotting jitter or a stalled cadence in a periodic stream.
  const timing = useMemo(() => {
    const recent = tab.lines.slice(-TIMING_WINDOW)
    if (recent.length < 2) return null
    let min = Infinity
    let max = 0
    let sum = 0
    let n = 0
    for (let i = 1; i < recent.length; i++) {
      const d = recent[i].atMs - recent[i - 1].atMs
      if (d < 0) continue
      if (d < min) min = d
      if (d > max) max = d
      sum += d
      n++
    }
    if (n === 0) return null
    return { avg: Math.round(sum / n), min: min === Infinity ? 0 : min, max }
  }, [tab.lines])

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
      {timing && (
        <span title={t('statsBar.gapTitle')}>
          {t('statsBar.gap', { avg: timing.avg, min: timing.min, max: timing.max })}
        </span>
      )}
    </div>
  )
}
