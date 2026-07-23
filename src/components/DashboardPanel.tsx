import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TabState } from '../state/tabsStore'
import { isNumeric, parseTelemetry } from '../lib/telemetryParse'

// Only the most recent lines are scanned for the latest value of each key —
// telemetry keys are normally emitted every cycle, so this stays current
// while keeping the per-render scan cheap on a full 50k-line buffer.
const SCAN_WINDOW = 500
// How many recent numeric samples each widget's sparkline draws.
const SPARK_POINTS = 40

/** A tiny inline trend line of a numeric field's recent values — normalized
 * to its own min/max so a nearly-flat signal still shows its wiggle. Pure
 * SVG, no charting library, since it's just a handful of points per widget. */
function Sparkline({ values }: { values: number[] }) {
  const w = 100
  const h = 24
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / range) * (h - 2) - 1
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      className="dashboard-sparkline"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline points={points} />
    </svg>
  )
}

/** Live dashboard: auto-discovers `key=value` / `key: value` / flat-JSON
 * fields in this tab's stream and shows the latest value of each as a
 * widget grid — a "what's this device reporting right now" view without
 * writing a plotter extractor or a script. A monitor toolbar flyout. */
export function DashboardPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation()

  const widgets = useMemo(() => {
    const latest = new Map<string, string>()
    const history = new Map<string, number[]>()
    const recent = tab.lines.slice(-SCAN_WINDOW)
    for (const line of recent) {
      const pairs = parseTelemetry(line.text)
      for (const [k, v] of Object.entries(pairs)) {
        latest.set(k, v)
        if (isNumeric(v)) {
          const arr = history.get(k) ?? []
          arr.push(Number(v))
          history.set(k, arr)
        }
      }
    }
    return [...latest.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => ({
        key,
        value,
        history: (history.get(key) ?? []).slice(-SPARK_POINTS),
      }))
  }, [tab.lines])

  return (
    <div className="dashboard-panel">
      {widgets.length === 0 ? (
        <p className="dashboard-empty">{t('dashboard.empty')}</p>
      ) : (
        <div className="dashboard-grid">
          {widgets.map(({ key, value, history }) => (
            <div key={key} className="dashboard-widget">
              <div className="dashboard-widget-key">{key}</div>
              <div className={`dashboard-widget-value ${isNumeric(value) ? 'mono numeric' : ''}`}>
                {value}
              </div>
              {history.length >= 2 && <Sparkline values={history} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
