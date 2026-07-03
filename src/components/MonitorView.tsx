import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTabsStore, type TabState, type ViewMode, type TimestampMode } from '../state/tabsStore'
import { DiskIcon } from './icons'
import { SignalBar } from './SignalBar'

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
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [logBusy, setLogBusy] = useState(false)

  const paused = tab.pausedAtSeq !== null
  const displayedLines = useMemo(
    () =>
      tab.pausedAtSeq === null ? tab.lines : tab.lines.filter((l) => l.seq <= tab.pausedAtSeq!),
    [tab.lines, tab.pausedAtSeq],
  )
  const pendingCount = tab.lines.length - displayedLines.length

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
    count: displayedLines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 20,
  })

  useEffect(() => {
    if (autoScroll && !paused && displayedLines.length > 0) {
      virtualizer.scrollToIndex(displayedLines.length - 1, { align: 'end' })
    }
  }, [displayedLines.length, autoScroll, paused, virtualizer])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setAutoScroll(distanceFromBottom < 40)
  }

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

      <div className="loglist" ref={scrollRef} onScroll={handleScroll}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const line = displayedLines[item.index]
            return (
              <div
                key={line.seq}
                className="logline"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`,
                }}
              >
                {tab.timestampMode !== 'off' && (
                  <span className="t">{formatTimestamp(tab, line.atMs)}</span>
                )}
                {tab.viewMode !== 'ascii' && <span className="hex">{bytesToHex(line.bytes)}</span>}
                {tab.viewMode !== 'hex' && <span className="msg">{line.text}</span>}
              </div>
            )
          })}
        </div>
      </div>

      {!autoScroll && !paused && (
        <button type="button" className="jump-bottom" onClick={() => setAutoScroll(true)}>
          ↓ jump to bottom
        </button>
      )}
    </div>
  )
}
