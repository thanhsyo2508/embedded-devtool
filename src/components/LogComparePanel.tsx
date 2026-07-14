import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTabsStore } from '../state/tabsStore'
import { diffLines, diffStats, type DiffRow } from '../lib/lineDiff'
import { XIcon } from './icons'

// Bounds the O(n·m) LCS matrix; only the most recent lines are compared past
// this, which is what matters for "what changed at the end of this run".
const MAX_DIFF_LINES = 2000

function toLines(text: string): { lines: string[]; truncated: boolean } {
  const all = text.replace(/\r/g, '').split('\n')
  if (all.length > MAX_DIFF_LINES) {
    return { lines: all.slice(all.length - MAX_DIFF_LINES), truncated: true }
  }
  return { lines: all, truncated: false }
}

/** Side-by-side diff of two logs (paste, or load from an open tab) — the
 * "working run vs broken run" comparison, with added/removed lines
 * highlighted. Reached from the command palette. */
export function LogComparePanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const tabs = useTabsStore((s) => s.tabs)
  const [leftText, setLeftText] = useState('')
  const [rightText, setRightText] = useState('')
  const [rows, setRows] = useState<DiffRow[] | null>(null)
  const [truncated, setTruncated] = useState(false)

  const loadFromTab = (tabId: string, side: 'left' | 'right') => {
    const tab = tabs.find((tb) => tb.id === tabId)
    if (!tab) return
    const text = tab.lines.map((l) => l.text).join('\n')
    if (side === 'left') setLeftText(text)
    else setRightText(text)
  }

  const runCompare = () => {
    const left = toLines(leftText)
    const right = toLines(rightText)
    setTruncated(left.truncated || right.truncated)
    setRows(diffLines(left.lines, right.lines))
  }

  const stats = rows ? diffStats(rows) : null

  const sourcePicker = (side: 'left' | 'right') => (
    <select
      defaultValue=""
      onChange={(e) => {
        if (e.target.value) loadFromTab(e.target.value, side)
        e.target.value = ''
      }}
    >
      <option value="">{t('logCompare.loadFromTab')}</option>
      {tabs.map((tab) => (
        <option key={tab.id} value={tab.id}>
          {tab.customLabel ?? tab.connectionLabel}
        </option>
      ))}
    </select>
  )

  return (
    <div className="settings-overlay log-compare-overlay" onClick={onClose}>
      <div className="log-compare-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">{t('logCompare.title')}</span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <XIcon />
          </button>
        </div>

        {!rows ? (
          <>
            <div className="log-compare-inputs">
              <div className="log-compare-input">
                <div className="log-compare-input-head">
                  <span>{t('logCompare.left')}</span>
                  {sourcePicker('left')}
                </div>
                <textarea
                  className="mono"
                  value={leftText}
                  placeholder={t('logCompare.placeholder')}
                  onChange={(e) => setLeftText(e.target.value)}
                />
              </div>
              <div className="log-compare-input">
                <div className="log-compare-input-head">
                  <span>{t('logCompare.right')}</span>
                  {sourcePicker('right')}
                </div>
                <textarea
                  className="mono"
                  value={rightText}
                  placeholder={t('logCompare.placeholder')}
                  onChange={(e) => setRightText(e.target.value)}
                />
              </div>
            </div>
            <button
              type="button"
              className="connect-button"
              disabled={!leftText && !rightText}
              onClick={runCompare}
            >
              {t('logCompare.compare')}
            </button>
          </>
        ) : (
          <>
            <div className="log-compare-summary">
              <span className="log-compare-added">+{stats?.added}</span>
              <span className="log-compare-removed">−{stats?.removed}</span>
              <span>{t('logCompare.unchanged', { count: stats?.same ?? 0 })}</span>
              {truncated && (
                <span className="log-compare-truncated">
                  {t('logCompare.truncated', { max: MAX_DIFF_LINES })}
                </span>
              )}
              <button type="button" className="log-compare-back" onClick={() => setRows(null)}>
                {t('logCompare.edit')}
              </button>
            </div>
            <div className="log-compare-result mono">
              {rows.map((row, i) => (
                <div key={i} className={`log-compare-row log-compare-${row.kind}`}>
                  <span className="log-compare-cell log-compare-left">{row.left ?? ''}</span>
                  <span className="log-compare-cell log-compare-right">{row.right ?? ''}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
