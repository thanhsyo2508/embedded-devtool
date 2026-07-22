import { useEffect, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { useProductionHistoryStore } from '../state/productionHistoryStore'
import { useToastStore } from '../state/toastStore'
import { TrashIcon } from './icons'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
// Long tables of 5,000 entries would make this panel sluggish to render
// for little benefit — the summary counters already cover the full
// history, this table is for spot-checking recent runs.
const MAX_DISPLAYED_ROWS = 300

function formatTime(atMs: number): string {
  return new Date(atMs).toLocaleString()
}

/** Cross-session totals for devices flashed by a production workflow
 * (ESP32 batch flash, STM32 Mass Production) — see productionHistoryStore
 * for exactly what counts as "production" here. */
export function ProductionStatsPanel() {
  const { t } = useTranslation()
  const entries = useProductionHistoryStore((s) => s.entries)
  const clear = useProductionHistoryStore((s) => s.clear)
  const addToast = useToastStore((s) => s.addToast)

  // Date.now() is impure, so it can't be read directly during render (see
  // React's purity rules) — this effect syncs the component with the
  // external "current time", refreshed whenever the entry list changes
  // so the 24h/7d windows stay current; the lint below is about calling
  // setState unconditionally, which is exactly what "sync to an external
  // clock" needs to do.
  const [now, setNow] = useState(0)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now())
  }, [entries])

  const total = entries.length
  const successCount = entries.filter((e) => e.success).length
  const failCount = total - successCount
  const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0
  const last24h = entries.filter((e) => now - e.atMs < DAY_MS).length
  const last7d = entries.filter((e) => now - e.atMs < WEEK_MS).length

  const handleExportCsv = async () => {
    const path = await save({
      defaultPath: 'production-history.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (!path) return
    const header = 'timestamp,deviceType,port,success,message,provisionedValue\n'
    const rows = entries
      .slice()
      .reverse()
      .map((e) =>
        [
          new Date(e.atMs).toISOString(),
          e.deviceType,
          e.port,
          e.success,
          `"${e.message.replace(/"/g, '""')}"`,
          e.provisionedValue ?? '',
        ].join(','),
      )
      .join('\n')
    try {
      await invoke('write_text_file', { path, contents: header + rows })
    } catch (err) {
      addToast('error', t('productionStats.exportCsvError', { message: String(err) }))
    }
  }

  const handleClear = () => {
    if (window.confirm(t('productionStats.clearConfirm'))) clear()
  }

  return (
    <div className="production-stats">
      <p className="ota-hint">{t('productionStats.hint')}</p>

      <div className="production-stats-grid">
        <div className="production-stats-card">
          <span className="production-stats-value">{total.toLocaleString()}</span>
          <span className="production-stats-label">{t('productionStats.total')}</span>
        </div>
        <div className="production-stats-card">
          <span className="production-stats-value">{successRate}%</span>
          <span className="production-stats-label">{t('productionStats.successRate')}</span>
        </div>
        <div className="production-stats-card">
          <span className="production-stats-value">{last24h.toLocaleString()}</span>
          <span className="production-stats-label">{t('productionStats.last24h')}</span>
        </div>
        <div className="production-stats-card">
          <span className="production-stats-value">{last7d.toLocaleString()}</span>
          <span className="production-stats-label">{t('productionStats.last7d')}</span>
        </div>
      </div>
      <p className="production-stats-breakdown">
        {t('productionStats.breakdown', { success: successCount, failed: failCount })}
      </p>

      <div className="flash-actions">
        <button type="button" onClick={() => void handleExportCsv()} disabled={total === 0}>
          {t('productionStats.exportCsv')}
        </button>
        <button type="button" className="flash-erase" onClick={handleClear} disabled={total === 0}>
          <TrashIcon /> {t('productionStats.clearHistory')}
        </button>
      </div>

      <div className="debug-table-wrap">
        <table className="debug-table">
          <thead>
            <tr>
              <th>{t('productionStats.time')}</th>
              <th>{t('productionStats.type')}</th>
              <th>{t('productionStats.port')}</th>
              <th>{t('productionStats.value')}</th>
              <th>{t('productionStats.status')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="netscan-empty">
                  {t('productionStats.empty')}
                </td>
              </tr>
            )}
            {entries.slice(0, MAX_DISPLAYED_ROWS).map((e) => (
              <tr key={e.id}>
                <td className="mono">{formatTime(e.atMs)}</td>
                <td>{e.deviceType.toUpperCase()}</td>
                <td className="mono">{e.port}</td>
                <td className="mono">{e.provisionedValue ?? '—'}</td>
                <td className={e.success ? 'mono' : 'mono connect-error'}>
                  {e.success ? '✓' : `✗ ${e.message}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
