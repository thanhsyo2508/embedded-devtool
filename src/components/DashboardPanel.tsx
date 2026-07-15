import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TabState } from '../state/tabsStore'
import { isNumeric, parseTelemetry } from '../lib/telemetryParse'

// Only the most recent lines are scanned for the latest value of each key —
// telemetry keys are normally emitted every cycle, so this stays current
// while keeping the per-render scan cheap on a full 50k-line buffer.
const SCAN_WINDOW = 500

/** Live dashboard: auto-discovers `key=value` / `key: value` / flat-JSON
 * fields in this tab's stream and shows the latest value of each as a
 * widget grid — a "what's this device reporting right now" view without
 * writing a plotter extractor or a script. A monitor toolbar flyout. */
export function DashboardPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation()

  const widgets = useMemo(() => {
    const latest = new Map<string, string>()
    const recent = tab.lines.slice(-SCAN_WINDOW)
    for (const line of recent) {
      const pairs = parseTelemetry(line.text)
      for (const [k, v] of Object.entries(pairs)) latest.set(k, v)
    }
    return [...latest.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [tab.lines])

  return (
    <div className="dashboard-panel">
      {widgets.length === 0 ? (
        <p className="dashboard-empty">{t('dashboard.empty')}</p>
      ) : (
        <div className="dashboard-grid">
          {widgets.map(([key, value]) => (
            <div key={key} className="dashboard-widget">
              <div className="dashboard-widget-key">{key}</div>
              <div className={`dashboard-widget-value ${isNumeric(value) ? 'mono numeric' : ''}`}>
                {value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
