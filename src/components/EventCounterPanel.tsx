import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTabsStore, type TabState } from '../state/tabsStore'
import { PlusIcon, TrashIcon } from './icons'

// Rate is measured over the most recent matches within this window.
const RATE_WINDOW_MS = 10_000

function isInvalid(pattern: string): boolean {
  if (pattern.length === 0) return false
  try {
    new RegExp(pattern)
    return false
  } catch {
    return true
  }
}

/** Live match count + rate for each user-defined regex over the tab's buffer.
 * Count is "matches currently in the buffer" (so it tracks the trimmed
 * window, not an all-time total); rate is matches in the last 10s. */
export function EventCounterPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const addEventCounter = useTabsStore((s) => s.addEventCounter)
  const removeEventCounter = useTabsStore((s) => s.removeEventCounter)
  const updateEventCounter = useTabsStore((s) => s.updateEventCounter)
  const toggleEventCounterEnabled = useTabsStore((s) => s.toggleEventCounterEnabled)

  // Re-tick once a second so the rate keeps updating (and decays to 0) even
  // when no new lines are arriving to trigger a re-render.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const stats = useMemo(() => {
    const out: Record<string, { count: number; rate: number }> = {}
    const cutoff = nowMs - RATE_WINDOW_MS
    for (const counter of tab.eventCounters) {
      if (!counter.enabled || counter.pattern.length === 0) {
        out[counter.id] = { count: 0, rate: 0 }
        continue
      }
      let re: RegExp
      try {
        re = new RegExp(counter.pattern, 'i')
      } catch {
        out[counter.id] = { count: 0, rate: 0 }
        continue
      }
      let count = 0
      let recent = 0
      for (const line of tab.lines) {
        if (re.test(line.text)) {
          count++
          if (line.atMs >= cutoff) recent++
        }
      }
      out[counter.id] = { count, rate: recent / (RATE_WINDOW_MS / 1000) }
    }
    return out
  }, [tab.eventCounters, tab.lines, nowMs])

  return (
    <div className="filter-bar">
      <p className="ota-hint">{t('eventCounter.hint')}</p>
      {tab.eventCounters.map((counter) => {
        const s = stats[counter.id] ?? { count: 0, rate: 0 }
        return (
          <div className="filter-row" key={counter.id}>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={counter.enabled}
                onChange={() => toggleEventCounterEnabled(tab.id, counter.id)}
              />
            </label>
            <input
              type="text"
              className="event-counter-label"
              value={counter.label}
              placeholder={t('eventCounter.labelPlaceholder')}
              onChange={(e) => updateEventCounter(tab.id, counter.id, { label: e.target.value })}
            />
            <input
              type="text"
              className={isInvalid(counter.pattern) ? 'invalid' : ''}
              value={counter.pattern}
              placeholder={t('filterBar.regexPlaceholder')}
              onChange={(e) => updateEventCounter(tab.id, counter.id, { pattern: e.target.value })}
            />
            {counter.enabled && !isInvalid(counter.pattern) && (
              <span className="event-counter-stat mono">
                {t('eventCounter.stat', { count: s.count, rate: s.rate.toFixed(1) })}
              </span>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label={t('eventCounter.removeCounter')}
              onClick={() => removeEventCounter(tab.id, counter.id)}
            >
              <TrashIcon />
            </button>
          </div>
        )
      })}
      <div className="filter-actions">
        <button type="button" onClick={() => addEventCounter(tab.id)}>
          <PlusIcon /> {t('eventCounter.addCounter')}
        </button>
      </div>
    </div>
  )
}
