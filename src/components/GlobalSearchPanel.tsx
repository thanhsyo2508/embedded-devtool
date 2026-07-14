import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useTabsStore } from '../state/tabsStore'
import { highlightMatches } from '../lib/highlight'
import { SearchIcon } from './icons'

interface SearchHit {
  tabId: string
  tabLabel: string
  seq: number
  text: string
}

// Caps keep a keystroke's scan cheap even with several tabs at
// maxLinesPerTab (50k by default) each — a production line's worth of
// matches isn't useful to page through anyway, so the newest few per tab
// is enough to find the one being looked for.
const MAX_HITS_PER_TAB = 30
const MAX_TOTAL_HITS = 300

/** Ctrl+Shift+G: search every open tab's buffer at once (not just the
 * focused one, unlike Ctrl+F inside MonitorView) and jump straight to a
 * match — useful when the same fault shows up on one of several devices'
 * tabs and it's not clear which one yet. Reuses the command palette's
 * overlay chrome since the interaction (type, arrow through results,
 * Enter) is identical. */
export function GlobalSearchPanel({
  onClose,
  onJumpToMatch,
}: {
  onClose: () => void
  onJumpToMatch: (tabId: string, query: string, seq: number) => void
}) {
  const { t } = useTranslation()
  const tabs = useTabsStore((s) => s.tabs)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 150)
    return () => clearTimeout(timer)
  }, [query])

  const searchRegex = useMemo(() => {
    if (debouncedQuery.length === 0) return null
    try {
      return new RegExp(debouncedQuery, 'i')
    } catch {
      return null
    }
  }, [debouncedQuery])

  const hits = useMemo(() => {
    if (!searchRegex) return []
    const results: SearchHit[] = []
    outer: for (const tab of tabs) {
      let countForTab = 0
      for (let i = tab.lines.length - 1; i >= 0; i--) {
        const line = tab.lines[i]
        if (!searchRegex.test(line.text)) continue
        results.push({
          tabId: tab.id,
          tabLabel: tab.connectionLabel,
          seq: line.seq,
          text: line.text,
        })
        countForTab++
        if (results.length >= MAX_TOTAL_HITS) break outer
        if (countForTab >= MAX_HITS_PER_TAB) break
      }
    }
    return results
  }, [searchRegex, tabs])

  // Same "adjust during render" reset pattern as CommandPalette's
  // queryForSelection, so the selection doesn't point past the end of a
  // freshly filtered (shorter) list.
  const [queryForSelection, setQueryForSelection] = useState(debouncedQuery)
  if (debouncedQuery !== queryForSelection) {
    setQueryForSelection(debouncedQuery)
    setSelected(0)
  }

  const jump = (hit: SearchHit) => {
    onJumpToMatch(hit.tabId, query, hit.seq)
    onClose()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((i) => Math.min(i + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[selected]
      if (hit) jump(hit)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-input-row">
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={t('globalSearch.placeholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="command-palette-list">
          {!searchRegex && <p className="command-palette-empty">{t('globalSearch.hint')}</p>}
          {searchRegex && hits.length === 0 && (
            <p className="command-palette-empty">{t('globalSearch.noMatches')}</p>
          )}
          {searchRegex &&
            hits.map((hit, i) => (
              <button
                key={`${hit.tabId}-${hit.seq}`}
                type="button"
                className={`command-palette-item global-search-item ${i === selected ? 'on' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => jump(hit)}
              >
                <span className="global-search-tab-label">{hit.tabLabel}</span>
                <span className="global-search-line-text mono">
                  {highlightMatches(hit.text, [searchRegex])}
                </span>
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}
