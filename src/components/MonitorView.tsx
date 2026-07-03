import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTabsStore, type TabState, type ViewMode, type TimestampMode } from '../state/tabsStore'
import { applyFilters, compileFilter } from '../lib/filterLines'
import { highlightMatches } from '../lib/highlight'
import { BookmarkIcon, DiskIcon, FilterIcon, SearchIcon, TargetIcon, XIcon } from './icons'
import { SignalBar } from './SignalBar'
import { StatsBar } from './StatsBar'
import { FilterBar } from './FilterBar'
import { TriggerBar } from './TriggerBar'

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')
}

function formatTimestamp(tab: TabState, atMs: number): string {
  if (tab.timestampMode === 'off') return ''
  if (tab.timestampMode === 'abs') return new Date(atMs).toLocaleTimeString()
  const base = tab.firstLineAtMs ?? atMs
  return `+${((atMs - base) / 1000).toFixed(3)}`
}

const VIEW_MODES: ViewMode[] = ['mixed', 'hex', 'ascii']
const TIMESTAMP_MODES: TimestampMode[] = ['delta', 'abs', 'off']

export function MonitorView({ tab }: { tab: TabState }) {
  const setViewMode = useTabsStore((s) => s.setViewMode)
  const setTimestampMode = useTabsStore((s) => s.setTimestampMode)
  const toggleLogging = useTabsStore((s) => s.toggleLogging)
  const clearLines = useTabsStore((s) => s.clearLines)
  const togglePause = useTabsStore((s) => s.togglePause)
  const toggleBookmark = useTabsStore((s) => s.toggleBookmark)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [logBusy, setLogBusy] = useState(false)
  const [filterBarOpen, setFilterBarOpen] = useState(false)
  const [triggerBarOpen, setTriggerBarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const [bookmarkCursor, setBookmarkCursor] = useState(0)

  const paused = tab.pausedAtSeq !== null
  const displayedLines = useMemo(
    () =>
      tab.pausedAtSeq === null ? tab.lines : tab.lines.filter((l) => l.seq <= tab.pausedAtSeq!),
    [tab.lines, tab.pausedAtSeq],
  )
  const pendingCount = tab.lines.length - displayedLines.length

  const filteredLines = useMemo(
    () => applyFilters(displayedLines, tab.filters),
    [displayedLines, tab.filters],
  )

  const includeHighlights = useMemo(
    () =>
      tab.filters
        .filter((f) => f.mode === 'include')
        .map(compileFilter)
        .filter((re): re is RegExp => re !== null),
    [tab.filters],
  )

  const searchRegex = useMemo(() => {
    if (!searchOpen || searchQuery.length === 0) return null
    try {
      return new RegExp(searchQuery, 'i')
    } catch {
      return null
    }
  }, [searchOpen, searchQuery])

  const searchMatchIndices = useMemo(() => {
    if (!searchRegex) return []
    const indices: number[] = []
    filteredLines.forEach((l, i) => {
      if (searchRegex.test(l.text)) indices.push(i)
    })
    return indices
  }, [searchRegex, filteredLines])

  useEffect(() => {
    setSearchIndex(0)
  }, [searchQuery])

  const bookmarkedIndices = useMemo(() => {
    if (tab.bookmarks.length === 0) return []
    const seqSet = new Set(tab.bookmarks)
    const indices: number[] = []
    filteredLines.forEach((l, i) => {
      if (seqSet.has(l.seq)) indices.push(i)
    })
    return indices
  }, [filteredLines, tab.bookmarks])

  const handleToggleLogging = () => {
    setLogBusy(true)
    void toggleLogging(tab.id).finally(() => setLogBusy(false))
  }

  const handleClear = () => {
    if (window.confirm('Clear the log buffer for this tab?')) {
      clearLines(tab.id)
    }
  }

  const virtualizer = useVirtualizer({
    count: filteredLines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 20,
  })

  useEffect(() => {
    if (autoScroll && !paused && filteredLines.length > 0) {
      virtualizer.scrollToIndex(filteredLines.length - 1, { align: 'end' })
    }
  }, [filteredLines.length, autoScroll, paused, virtualizer])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setAutoScroll(distanceFromBottom < 40)
  }

  const gotoSearchMatch = (dir: 1 | -1) => {
    if (searchMatchIndices.length === 0) return
    const next = (searchIndex + dir + searchMatchIndices.length) % searchMatchIndices.length
    setSearchIndex(next)
    virtualizer.scrollToIndex(searchMatchIndices[next], { align: 'center' })
  }

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      gotoSearchMatch(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setSearchOpen(false)
    }
  }

  const gotoBookmark = (dir: 1 | -1) => {
    if (bookmarkedIndices.length === 0) return
    const next = (bookmarkCursor + dir + bookmarkedIndices.length) % bookmarkedIndices.length
    setBookmarkCursor(next)
    virtualizer.scrollToIndex(bookmarkedIndices[next], { align: 'center' })
  }

  // M4-search: Ctrl+F opens the buffer search bar; scoped to this component
  // (rather than App.tsx's global shortcut handler) since jumping to a match
  // needs direct access to this tab's virtualizer.
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="monitor-view">
      <div className="toolbar">
        <div className="seg">
          {VIEW_MODES.map((mode) => (
            <span
              key={mode}
              className={tab.viewMode === mode ? 'on' : ''}
              onClick={() => setViewMode(tab.id, mode)}
            >
              {mode}
            </span>
          ))}
        </div>
        <div className="seg">
          {TIMESTAMP_MODES.map((mode) => (
            <span
              key={mode}
              className={tab.timestampMode === mode ? 'on' : ''}
              onClick={() => setTimestampMode(tab.id, mode)}
            >
              {mode}
            </span>
          ))}
        </div>
        <button type="button" className={paused ? 'on' : ''} onClick={() => togglePause(tab.id)}>
          {paused ? `Resume${pendingCount > 0 ? ` (+${pendingCount})` : ''}` : 'Pause'}
        </button>
        <button type="button" onClick={handleClear}>
          Clear
        </button>
        <button
          type="button"
          className={filterBarOpen || tab.filters.length > 0 ? 'on' : ''}
          onClick={() => setFilterBarOpen((v) => !v)}
        >
          <FilterIcon /> Filters{tab.filters.length > 0 ? ` (${tab.filters.length})` : ''}
        </button>
        <button
          type="button"
          className={triggerBarOpen || tab.triggers.length > 0 ? 'on' : ''}
          onClick={() => setTriggerBarOpen((v) => !v)}
        >
          <TargetIcon /> Triggers{tab.triggers.length > 0 ? ` (${tab.triggers.length})` : ''}
        </button>
        {bookmarkedIndices.length > 0 && (
          <div className="bookmark-nav">
            <button type="button" onClick={() => gotoBookmark(-1)} aria-label="Previous bookmark">
              <BookmarkIcon />‹
            </button>
            <span className="mono">
              {bookmarkCursor + 1}/{bookmarkedIndices.length}
            </span>
            <button type="button" onClick={() => gotoBookmark(1)} aria-label="Next bookmark">
              ›
            </button>
          </div>
        )}
        <span className="line-count">{tab.lines.length.toLocaleString()} lines</span>
        <button
          type="button"
          className={`log-toggle ${tab.isLogging ? 'on' : ''}`}
          disabled={logBusy}
          title={tab.isLogging ? `Logging to ${tab.logDir ?? '…'}` : 'Log to file'}
          onClick={handleToggleLogging}
        >
          <DiskIcon />
          {tab.isLogging ? 'Logging' : 'Log'}
        </button>
        {tab.status === 'error' && <span className="tab-error">{tab.errorMessage}</span>}
      </div>

      <SignalBar tab={tab} />
      <StatsBar tab={tab} />
      {filterBarOpen && <FilterBar tab={tab} visibleCount={filteredLines.length} />}
      {triggerBarOpen && <TriggerBar tab={tab} />}

      <div className="loglist" ref={scrollRef} onScroll={handleScroll}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const line = filteredLines[item.index]
            const isCurrentSearchMatch =
              searchRegex !== null && searchMatchIndices[searchIndex] === item.index
            return (
              <div
                key={line.seq}
                className={`logline level-${line.level ?? 'none'}${isCurrentSearchMatch ? ' current-match' : ''}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <button
                  type="button"
                  className={`bookmark-toggle ${tab.bookmarks.includes(line.seq) ? 'on' : ''}`}
                  aria-label="Toggle bookmark"
                  onClick={() => toggleBookmark(tab.id, line.seq)}
                >
                  <BookmarkIcon />
                </button>
                {tab.timestampMode !== 'off' && (
                  <span className="t">{formatTimestamp(tab, line.atMs)}</span>
                )}
                {tab.viewMode !== 'ascii' && <span className="hex">{bytesToHex(line.bytes)}</span>}
                {tab.viewMode !== 'hex' && (
                  <span className="msg">
                    {searchRegex
                      ? highlightMatches(line.text, [searchRegex])
                      : highlightMatches(line.text, includeHighlights)}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {searchOpen && (
          <div className="search-overlay">
            <SearchIcon />
            <input
              type="text"
              autoFocus
              placeholder="Search buffer…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            <span className="mono">
              {searchMatchIndices.length > 0
                ? `${searchIndex + 1}/${searchMatchIndices.length}`
                : '0/0'}
            </span>
            <button type="button" onClick={() => gotoSearchMatch(-1)} aria-label="Previous match">
              ‹
            </button>
            <button type="button" onClick={() => gotoSearchMatch(1)} aria-label="Next match">
              ›
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Close search"
              onClick={() => setSearchOpen(false)}
            >
              <XIcon />
            </button>
          </div>
        )}
      </div>

      {!autoScroll && !paused && (
        <button type="button" className="jump-bottom" onClick={() => setAutoScroll(true)}>
          ↓ jump to bottom
        </button>
      )}
    </div>
  )
}
