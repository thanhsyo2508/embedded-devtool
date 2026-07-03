import { create } from 'zustand'
import {
  closeSerialPort,
  onSerialData,
  onSerialLifecycle,
  openSerialPort,
  startSerialLogging,
  stopSerialLogging,
  writeSerialPort,
  type OpenPortRequest,
} from '../api/serial'
import { useSettingsStore, type Encoding, type NewlineMode } from './settingsStore'

export interface LogLine {
  seq: number
  atMs: number
  bytes: number[]
  text: string
}

export type ViewMode = 'mixed' | 'hex' | 'ascii'
export type TimestampMode = 'delta' | 'abs' | 'off'
export type LineEnding = 'none' | 'cr' | 'lf' | 'crlf'
export type TabStatus = 'open' | 'error'

export interface TabState {
  id: string
  portName: string
  baudRate: number
  status: TabStatus
  errorMessage?: string
  lines: LogLine[]
  pendingBytes: number[]
  pendingAtMs: number | null
  firstLineAtMs: number | null
  nextSeq: number
  viewMode: ViewMode
  timestampMode: TimestampMode
  lineEnding: LineEnding
  sendHistory: string[]
  isLogging: boolean
  logDir?: string
  /** When set, the monitor view freezes on lines up to this seq — new data
   * keeps arriving and accumulating in `lines` underneath, nothing is lost,
   * only the displayed view stops moving until resumed. */
  pausedAtSeq: number | null
}

interface TabsStore {
  tabs: TabState[]
  activeTabId: string | null
  eventsWired: boolean

  wireEventsOnce: () => void
  openTab: (req: OpenPortRequest) => Promise<void>
  closeTab: (id: string) => Promise<void>
  setActiveTab: (id: string) => void
  setViewMode: (id: string, mode: ViewMode) => void
  setTimestampMode: (id: string, mode: TimestampMode) => void
  setLineEnding: (id: string, ending: LineEnding) => void
  send: (id: string, text: string) => Promise<void>
  sendBytes: (id: string, bytes: number[], historyEntry: string) => Promise<void>
  toggleLogging: (id: string) => Promise<void>
  flushStaleTabs: () => void
  clearLines: (id: string) => void
  togglePause: (id: string) => void
}

const LINE_ENDING_BYTES: Record<LineEnding, number[]> = {
  none: [],
  cr: [0x0d],
  lf: [0x0a],
  crlf: [0x0d, 0x0a],
}

// A source that never sends the configured newline (a prompt waiting for
// input, a \r-only progress readout, a device that just doesn't terminate
// its last line) would otherwise sit in `pendingBytes` forever and never
// reach the screen. These two limits force it into a real line instead:
// whichever triggers first.
const STALE_FLUSH_MS = 400
const MAX_PENDING_BYTES = 8192

// Splits `bytes` into complete lines per the configured newline mode,
// returning any trailing partial line unconsumed. For 'lf' mode, a stray
// trailing \r (common when firmware emits \r\n but the user picked plain
// LF splitting) is stripped from the line content.
function splitLines(
  bytes: number[],
  newline: NewlineMode,
): { lines: number[][]; consumedUpTo: number } {
  const lines: number[][] = []
  let start = 0
  let i = 0
  while (i < bytes.length) {
    if (newline === 'crlf' && bytes[i] === 0x0d && bytes[i + 1] === 0x0a) {
      lines.push(bytes.slice(start, i))
      i += 2
      start = i
      continue
    }
    if (newline === 'cr' && bytes[i] === 0x0d) {
      lines.push(bytes.slice(start, i))
      i += 1
      start = i
      continue
    }
    if (newline === 'lf' && bytes[i] === 0x0a) {
      const end = i > start && bytes[i - 1] === 0x0d ? i - 1 : i
      lines.push(bytes.slice(start, end))
      i += 1
      start = i
      continue
    }
    i++
  }
  return { lines, consumedUpTo: start }
}

function appendBytesToTab(tab: TabState, incoming: number[]): TabState {
  const now = performance.now()
  const { newline, maxLinesPerTab, encoding } = useSettingsStore.getState()
  const bytes = [...tab.pendingBytes, ...incoming]
  const { lines: splitBytes, consumedUpTo } = splitLines(bytes, newline)

  let nextSeq = tab.nextSeq
  let firstLineAtMs = tab.firstLineAtMs
  const newLines: LogLine[] = splitBytes.map((lineBytes) => {
    const atMs = tab.pendingAtMs ?? now
    if (firstLineAtMs === null) firstLineAtMs = atMs
    return {
      seq: nextSeq++,
      atMs,
      bytes: lineBytes,
      text: bytesToText(lineBytes, encoding),
    }
  })

  let remaining = bytes.slice(consumedUpTo)
  let pendingAtMs = remaining.length > 0 ? (tab.pendingAtMs ?? now) : null

  if (remaining.length > MAX_PENDING_BYTES) {
    const atMs = pendingAtMs ?? now
    if (firstLineAtMs === null) firstLineAtMs = atMs
    newLines.push({
      seq: nextSeq++,
      atMs,
      bytes: remaining,
      text: bytesToText(remaining, encoding),
    })
    remaining = []
    pendingAtMs = null
  }

  const mergedLines = newLines.length > 0 ? [...tab.lines, ...newLines] : tab.lines
  const trimmed =
    mergedLines.length > maxLinesPerTab
      ? mergedLines.slice(mergedLines.length - maxLinesPerTab)
      : mergedLines

  return {
    ...tab,
    lines: trimmed,
    pendingBytes: remaining,
    pendingAtMs,
    nextSeq,
    firstLineAtMs,
  }
}

// Promotes whatever is sitting in `pendingBytes` to a real, permanent line
// — used once a tab has gone quiet for STALE_FLUSH_MS (see flushStaleTabs).
function commitPendingLine(tab: TabState, encoding: Encoding, maxLinesPerTab: number): TabState {
  if (tab.pendingBytes.length === 0) return tab
  const atMs = tab.pendingAtMs ?? performance.now()
  const line: LogLine = {
    seq: tab.nextSeq,
    atMs,
    bytes: tab.pendingBytes,
    text: bytesToText(tab.pendingBytes, encoding),
  }
  const mergedLines = [...tab.lines, line]
  const trimmed =
    mergedLines.length > maxLinesPerTab
      ? mergedLines.slice(mergedLines.length - maxLinesPerTab)
      : mergedLines
  return {
    ...tab,
    lines: trimmed,
    pendingBytes: [],
    pendingAtMs: null,
    nextSeq: tab.nextSeq + 1,
    firstLineAtMs: tab.firstLineAtMs ?? atMs,
  }
}

function bytesToText(bytes: number[], encoding: Encoding): string {
  if (encoding === 'ascii') {
    return bytes.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes))
}

export const useTabsStore = create<TabsStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  eventsWired: false,

  wireEventsOnce: () => {
    if (get().eventsWired) return
    set({ eventsWired: true })

    setInterval(() => get().flushStaleTabs(), 200)

    void onSerialData((batch) => {
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === batch.id ? appendBytesToTab(tab, batch.data) : tab,
        ),
      }))
    })

    void onSerialLifecycle((event) => {
      set((state) => ({
        tabs: state.tabs.map((tab) => {
          if (tab.id !== event.streamId) return tab
          if (event.kind === 'opened') return { ...tab, status: 'open', errorMessage: undefined }
          if (event.kind === 'error')
            return { ...tab, status: 'error', errorMessage: event.message }
          return tab
        }),
      }))
    })
  },

  openTab: async (req) => {
    const newTab: TabState = {
      id: req.id,
      portName: req.portName,
      baudRate: req.baudRate,
      status: 'open',
      lines: [],
      pendingBytes: [],
      pendingAtMs: null,
      firstLineAtMs: null,
      nextSeq: 0,
      viewMode: 'mixed',
      timestampMode: 'delta',
      lineEnding: 'crlf',
      sendHistory: [],
      isLogging: false,
      pausedAtSeq: null,
    }
    set((state) => ({ tabs: [...state.tabs, newTab], activeTabId: newTab.id }))
    try {
      await openSerialPort(req)
    } catch (err) {
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === req.id ? { ...tab, status: 'error', errorMessage: String(err) } : tab,
        ),
      }))
    }
  },

  closeTab: async (id) => {
    await closeSerialPort(id).catch(() => {})
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== id)
      const activeTabId = state.activeTabId === id ? (tabs[0]?.id ?? null) : state.activeTabId
      return { tabs, activeTabId }
    })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  setViewMode: (id, mode) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, viewMode: mode } : tab)),
    })),

  setTimestampMode: (id, mode) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, timestampMode: mode } : tab)),
    })),

  setLineEnding: (id, ending) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, lineEnding: ending } : tab)),
    })),

  send: async (id, text) => {
    await get().sendBytes(id, Array.from(new TextEncoder().encode(text)), text)
  },

  sendBytes: async (id, bytes, historyEntry) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    const withLineEnding = [...bytes, ...LINE_ENDING_BYTES[tab.lineEnding]]
    await writeSerialPort(id, withLineEnding)
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id && historyEntry.length > 0
          ? { ...t, sendHistory: [historyEntry, ...t.sendHistory].slice(0, 100) }
          : t,
      ),
    }))
  },

  toggleLogging: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    if (tab.isLogging) {
      await stopSerialLogging(id)
      set((state) => ({
        tabs: state.tabs.map((t) => (t.id === id ? { ...t, isLogging: false } : t)),
      }))
    } else {
      const logDir = await startSerialLogging(id)
      set((state) => ({
        tabs: state.tabs.map((t) => (t.id === id ? { ...t, isLogging: true, logDir } : t)),
      }))
    }
  },

  flushStaleTabs: () => {
    const { encoding, maxLinesPerTab } = useSettingsStore.getState()
    const now = performance.now()
    set((state) => {
      let changed = false
      const tabs = state.tabs.map((tab) => {
        if (tab.pendingBytes.length === 0 || tab.pendingAtMs === null) return tab
        if (now - tab.pendingAtMs < STALE_FLUSH_MS) return tab
        changed = true
        return commitPendingLine(tab, encoding, maxLinesPerTab)
      })
      return changed ? { tabs } : {}
    })
  },

  clearLines: (id) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              lines: [],
              pendingBytes: [],
              pendingAtMs: null,
              firstLineAtMs: null,
              pausedAtSeq: null,
            }
          : tab,
      ),
    })),

  togglePause: (id) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== id) return tab
        if (tab.pausedAtSeq !== null) return { ...tab, pausedAtSeq: null }
        const lastSeq = tab.lines.length > 0 ? tab.lines[tab.lines.length - 1].seq : -1
        return { ...tab, pausedAtSeq: lastSeq }
      }),
    })),
}))
