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
import { detectLogLevel, type LogLevel } from '../lib/logLevel'
import { matchTriggers } from '../lib/triggers'
import { parseHex } from '../lib/hex'
import { playBeep } from '../lib/beep'
import { invoke } from '@tauri-apps/api/core'
import {
  onScriptAlert,
  onScriptDone,
  onScriptError,
  onScriptLog,
  onScriptPlot,
  runScript as runScriptApi,
  stopScript as stopScriptApi,
} from '../api/script'
import { usePlotStore } from './plotStore'

export interface LogLine {
  seq: number
  atMs: number
  bytes: number[]
  text: string
  level: LogLevel | null
}

export type FilterMode = 'include' | 'exclude'

export interface FilterRule {
  id: string
  pattern: string
  mode: FilterMode
  enabled: boolean
}

export type TriggerActionType = 'send' | 'sound' | 'file' | 'bookmark'

export interface TriggerAction {
  type: TriggerActionType
  sendText: string
  sendIsHex: boolean
  filePath: string
}

export interface TriggerRule {
  id: string
  pattern: string
  enabled: boolean
  action: TriggerAction
}

export interface MacroStep {
  text: string
  isHex: boolean
  delayMs: number
}

export interface ScriptConsoleEntry {
  kind: 'log' | 'alert' | 'error'
  message: string
  atMs: number
}

export type ViewMode = 'mixed' | 'hex' | 'ascii'
export type TimestampMode = 'delta' | 'abs' | 'off'
export type LineEnding = 'none' | 'cr' | 'lf' | 'crlf'
export type TabStatus = 'open' | 'closed' | 'error'

export interface TabState {
  id: string
  portName: string
  baudRate: number
  status: TabStatus
  errorMessage?: string
  /** The request last used to open this port — kept around so Reconnect can
   * reopen with the exact same port/baud/framing instead of making the user
   * re-enter everything. */
  connectionConfig: OpenPortRequest
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
  filters: FilterRule[]
  bookmarks: number[]
  /** Cumulative counters for the stats panel — unlike `lines`, these never
   * shrink when the buffer is trimmed to `maxLinesPerTab`. */
  totalBytesReceived: number
  totalLinesReceived: number
  errorCount: number
  connectedAtMs: number
  triggers: TriggerRule[]
  macroRecording: boolean
  macroPlaying: boolean
  macroSteps: MacroStep[]
  macroLastStepAtMs: number | null
  scriptCode: string
  scriptRunning: boolean
  scriptConsole: ScriptConsoleEntry[]
}

interface TabsStore {
  tabs: TabState[]
  activeTabId: string | null
  eventsWired: boolean

  wireEventsOnce: () => void
  openTab: (req: OpenPortRequest) => Promise<void>
  closeTab: (id: string) => Promise<void>
  disconnectTab: (id: string) => Promise<void>
  reconnectTab: (id: string) => Promise<void>
  setActiveTab: (id: string) => void
  setViewMode: (id: string, mode: ViewMode) => void
  setTimestampMode: (id: string, mode: TimestampMode) => void
  setLineEnding: (id: string, ending: LineEnding) => void
  send: (id: string, text: string) => Promise<void>
  sendBytes: (id: string, bytes: number[], historyEntry: string, isHex?: boolean) => Promise<void>
  toggleLogging: (id: string) => Promise<void>
  flushStaleTabs: () => void
  clearLines: (id: string) => void
  togglePause: (id: string) => void
  addFilter: (id: string, mode: FilterMode) => void
  removeFilter: (id: string, filterId: string) => void
  updateFilterPattern: (id: string, filterId: string, pattern: string) => void
  toggleFilterEnabled: (id: string, filterId: string) => void
  setFilters: (id: string, filters: FilterRule[]) => void
  toggleBookmark: (id: string, seq: number) => void
  addBookmark: (id: string, seq: number) => void
  addTrigger: (id: string) => void
  removeTrigger: (id: string, triggerId: string) => void
  updateTrigger: (
    id: string,
    triggerId: string,
    patch: Partial<Pick<TriggerRule, 'pattern' | 'enabled'>> & { action?: Partial<TriggerAction> },
  ) => void
  toggleTriggerEnabled: (id: string, triggerId: string) => void
  setTriggers: (id: string, triggers: TriggerRule[]) => void
  startMacroRecording: (id: string) => void
  stopMacroRecording: (id: string) => void
  clearMacro: (id: string) => void
  removeMacroStep: (id: string, index: number) => void
  updateMacroStepDelay: (id: string, index: number, delayMs: number) => void
  playMacro: (id: string) => Promise<void>
  setScriptCode: (id: string, code: string) => void
  runScript: (id: string) => Promise<void>
  stopScript: (id: string) => Promise<void>
  clearScriptConsole: (id: string) => void
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

function appendBytesToTab(
  tab: TabState,
  incoming: number[],
  onNewLines?: (lines: LogLine[]) => void,
): TabState {
  const now = performance.now()
  const { newline, maxLinesPerTab, encoding } = useSettingsStore.getState()
  const bytes = [...tab.pendingBytes, ...incoming]
  const { lines: splitBytes, consumedUpTo } = splitLines(bytes, newline)

  let nextSeq = tab.nextSeq
  let firstLineAtMs = tab.firstLineAtMs
  const newLines: LogLine[] = splitBytes.map((lineBytes) => {
    const atMs = tab.pendingAtMs ?? now
    if (firstLineAtMs === null) firstLineAtMs = atMs
    const text = bytesToText(lineBytes, encoding)
    return {
      seq: nextSeq++,
      atMs,
      bytes: lineBytes,
      text,
      level: detectLogLevel(text),
    }
  })

  let remaining = bytes.slice(consumedUpTo)
  let pendingAtMs = remaining.length > 0 ? (tab.pendingAtMs ?? now) : null

  if (remaining.length > MAX_PENDING_BYTES) {
    const atMs = pendingAtMs ?? now
    if (firstLineAtMs === null) firstLineAtMs = atMs
    const text = bytesToText(remaining, encoding)
    newLines.push({
      seq: nextSeq++,
      atMs,
      bytes: remaining,
      text,
      level: detectLogLevel(text),
    })
    remaining = []
    pendingAtMs = null
  }

  if (newLines.length > 0) onNewLines?.(newLines)

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
    totalBytesReceived: tab.totalBytesReceived + incoming.length,
    totalLinesReceived: tab.totalLinesReceived + newLines.length,
    errorCount: tab.errorCount + newLines.filter((l) => l.level === 'error').length,
  }
}

// Promotes whatever is sitting in `pendingBytes` to a real, permanent line
// — used once a tab has gone quiet for STALE_FLUSH_MS (see flushStaleTabs).
function commitPendingLine(tab: TabState, encoding: Encoding, maxLinesPerTab: number): TabState {
  if (tab.pendingBytes.length === 0) return tab
  const atMs = tab.pendingAtMs ?? performance.now()
  const text = bytesToText(tab.pendingBytes, encoding)
  const level = detectLogLevel(text)
  const line: LogLine = {
    seq: tab.nextSeq,
    atMs,
    bytes: tab.pendingBytes,
    text,
    level,
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
    totalLinesReceived: tab.totalLinesReceived + 1,
    errorCount: tab.errorCount + (level === 'error' ? 1 : 0),
  }
}

function bytesToText(bytes: number[], encoding: Encoding): string {
  if (encoding === 'ascii') {
    return bytes.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes))
}

// Trigger sends/bookmarks go through the same store actions a user would
// trigger by hand, but with historyEntry '' so they don't pollute send
// history or get captured into an in-progress macro recording (see
// sendBytes below) — only sends a person actually typed should do that.
async function dispatchTriggerAction(
  tabId: string,
  action: TriggerAction,
  line: LogLine,
  get: () => TabsStore,
): Promise<void> {
  switch (action.type) {
    case 'send': {
      if (action.sendText.length === 0) return
      const bytes = action.sendIsHex
        ? parseHex(action.sendText)
        : Array.from(new TextEncoder().encode(action.sendText))
      if (bytes) await get().sendBytes(tabId, bytes, '')
      break
    }
    case 'sound':
      playBeep()
      break
    case 'file':
      if (action.filePath.length > 0) {
        await invoke('append_trigger_log', { path: action.filePath, line: line.text })
      }
      break
    case 'bookmark':
      get().addBookmark(tabId, line.seq)
      break
  }
}

async function runTriggers(tab: TabState, lines: LogLine[], get: () => TabsStore): Promise<void> {
  const matches = matchTriggers(tab.triggers, lines)
  for (const { rule, line } of matches) {
    try {
      await dispatchTriggerAction(tab.id, rule.action, line, get)
    } catch {
      // best-effort — one bad trigger action shouldn't block the rest
    }
  }
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
      let newLines: LogLine[] = []
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === batch.id
            ? appendBytesToTab(tab, batch.data, (lines) => {
                newLines = lines
              })
            : tab,
        ),
      }))
      if (newLines.length === 0) return
      const tab = get().tabs.find((t) => t.id === batch.id)
      if (tab && tab.triggers.length > 0) void runTriggers(tab, newLines, get)
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

    const appendConsole = (id: string, kind: ScriptConsoleEntry['kind'], message: string) =>
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.id === id
            ? {
                ...tab,
                scriptConsole: [...tab.scriptConsole, { kind, message, atMs: Date.now() }].slice(
                  -500,
                ),
              }
            : tab,
        ),
      }))

    void onScriptLog((e) => appendConsole(e.id, 'log', e.message))
    void onScriptAlert((e) => appendConsole(e.id, 'alert', e.message))
    void onScriptError((e) => appendConsole(e.id, 'error', e.message))
    void onScriptDone((e) =>
      set((state) => ({
        tabs: state.tabs.map((tab) => (tab.id === e.id ? { ...tab, scriptRunning: false } : tab)),
      })),
    )
    void onScriptPlot((e) =>
      usePlotStore.getState().ingestScriptPoint(e.streamId, e.channel, e.value),
    )
  },

  openTab: async (req) => {
    const newTab: TabState = {
      id: req.id,
      portName: req.portName,
      baudRate: req.baudRate,
      status: 'open',
      connectionConfig: req,
      lines: [],
      pendingBytes: [],
      pendingAtMs: null,
      firstLineAtMs: null,
      nextSeq: 0,
      viewMode: 'ascii',
      timestampMode: 'off',
      lineEnding: 'crlf',
      sendHistory: [],
      isLogging: false,
      pausedAtSeq: null,
      filters: [],
      bookmarks: [],
      totalBytesReceived: 0,
      totalLinesReceived: 0,
      errorCount: 0,
      connectedAtMs: Date.now(),
      triggers: [],
      macroRecording: false,
      macroPlaying: false,
      macroSteps: [],
      macroLastStepAtMs: null,
      scriptCode: '',
      scriptRunning: false,
      scriptConsole: [],
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
    if (get().tabs.find((t) => t.id === id)?.scriptRunning) {
      await stopScriptApi(id).catch(() => {})
    }
    await closeSerialPort(id).catch(() => {})
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== id)
      const activeTabId = state.activeTabId === id ? (tabs[0]?.id ?? null) : state.activeTabId
      return { tabs, activeTabId }
    })
  },

  // Stops the underlying port but keeps the tab (and its buffered log,
  // filters, triggers, script) around — unlike closeTab, which removes the
  // tab entirely. Lets Reconnect below bring the same tab back to life.
  disconnectTab: async (id) => {
    if (get().tabs.find((t) => t.id === id)?.scriptRunning) {
      await stopScriptApi(id).catch(() => {})
    }
    await closeSerialPort(id).catch(() => {})
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, status: 'closed', errorMessage: undefined } : tab,
      ),
    }))
  },

  // Mirrors openTab: success flips this tab to 'open' via the
  // serial://lifecycle listener in wireEventsOnce, not here directly.
  reconnectTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    try {
      await openSerialPort(tab.connectionConfig)
    } catch (err) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id ? { ...t, status: 'error', errorMessage: String(err) } : t,
        ),
      }))
    }
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

  sendBytes: async (id, bytes, historyEntry, isHex = false) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    const withLineEnding = [...bytes, ...LINE_ENDING_BYTES[tab.lineEnding]]
    await writeSerialPort(id, withLineEnding)
    const now = Date.now()
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== id || historyEntry.length === 0) return t
        const withHistory = { ...t, sendHistory: [historyEntry, ...t.sendHistory].slice(0, 100) }
        if (!t.macroRecording) return withHistory
        const delayMs = t.macroLastStepAtMs === null ? 0 : now - t.macroLastStepAtMs
        return {
          ...withHistory,
          macroSteps: [...t.macroSteps, { text: historyEntry, isHex, delayMs }],
          macroLastStepAtMs: now,
        }
      }),
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

  addFilter: (id, mode) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              filters: [
                ...tab.filters,
                {
                  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  pattern: '',
                  mode,
                  enabled: true,
                },
              ],
            }
          : tab,
      ),
    })),

  removeFilter: (id, filterId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, filters: tab.filters.filter((f) => f.id !== filterId) } : tab,
      ),
    })),

  updateFilterPattern: (id, filterId, pattern) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              filters: tab.filters.map((f) => (f.id === filterId ? { ...f, pattern } : f)),
            }
          : tab,
      ),
    })),

  toggleFilterEnabled: (id, filterId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              filters: tab.filters.map((f) =>
                f.id === filterId ? { ...f, enabled: !f.enabled } : f,
              ),
            }
          : tab,
      ),
    })),

  // Regenerates ids rather than reusing the preset's stored ones — loaded
  // filters need to be distinct from whatever a saved preset (or another
  // tab loading the same preset) already carries around.
  setFilters: (id, filters) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              filters: filters.map((f) => ({
                ...f,
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              })),
            }
          : tab,
      ),
    })),

  toggleBookmark: (id, seq) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== id) return tab
        const bookmarks = tab.bookmarks.includes(seq)
          ? tab.bookmarks.filter((s) => s !== seq)
          : [...tab.bookmarks, seq].sort((a, b) => a - b)
        return { ...tab, bookmarks }
      }),
    })),

  addBookmark: (id, seq) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id && !tab.bookmarks.includes(seq)
          ? { ...tab, bookmarks: [...tab.bookmarks, seq].sort((a, b) => a - b) }
          : tab,
      ),
    })),

  addTrigger: (id) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              triggers: [
                ...tab.triggers,
                {
                  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  pattern: '',
                  enabled: true,
                  action: { type: 'bookmark', sendText: '', sendIsHex: false, filePath: '' },
                },
              ],
            }
          : tab,
      ),
    })),

  removeTrigger: (id, triggerId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, triggers: tab.triggers.filter((t) => t.id !== triggerId) } : tab,
      ),
    })),

  updateTrigger: (id, triggerId, patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              triggers: tab.triggers.map((t) =>
                t.id === triggerId
                  ? { ...t, ...patch, action: { ...t.action, ...patch.action } }
                  : t,
              ),
            }
          : tab,
      ),
    })),

  toggleTriggerEnabled: (id, triggerId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              triggers: tab.triggers.map((t) =>
                t.id === triggerId ? { ...t, enabled: !t.enabled } : t,
              ),
            }
          : tab,
      ),
    })),

  setTriggers: (id, triggers) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              triggers: triggers.map((t) => ({
                ...t,
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              })),
            }
          : tab,
      ),
    })),

  startMacroRecording: (id) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? { ...tab, macroRecording: true, macroSteps: [], macroLastStepAtMs: null }
          : tab,
      ),
    })),

  stopMacroRecording: (id) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, macroRecording: false } : tab)),
    })),

  clearMacro: (id) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, macroSteps: [], macroLastStepAtMs: null } : tab,
      ),
    })),

  removeMacroStep: (id, index) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, macroSteps: tab.macroSteps.filter((_, i) => i !== index) } : tab,
      ),
    })),

  updateMacroStepDelay: (id, index, delayMs) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              macroSteps: tab.macroSteps.map((step, i) =>
                i === index ? { ...step, delayMs: Math.max(0, delayMs) } : step,
              ),
            }
          : tab,
      ),
    })),

  playMacro: async (id) => {
    const steps = get().tabs.find((t) => t.id === id)?.macroSteps ?? []
    if (steps.length === 0) return
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, macroPlaying: true } : t)),
    }))
    try {
      for (const step of steps) {
        if (step.delayMs > 0) await new Promise((r) => setTimeout(r, step.delayMs))
        const bytes = step.isHex
          ? parseHex(step.text)
          : Array.from(new TextEncoder().encode(step.text))
        if (bytes) await get().sendBytes(id, bytes, '')
      }
    } finally {
      set((state) => ({
        tabs: state.tabs.map((t) => (t.id === id ? { ...t, macroPlaying: false } : t)),
      }))
    }
  },

  setScriptCode: (id, code) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, scriptCode: code } : tab)),
    })),

  runScript: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab || tab.scriptRunning) return
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, scriptRunning: true } : t)),
    }))
    try {
      await runScriptApi(id, id, tab.scriptCode)
    } catch (err) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id
            ? {
                ...t,
                scriptRunning: false,
                scriptConsole: [
                  ...t.scriptConsole,
                  { kind: 'error', message: String(err), atMs: Date.now() },
                ],
              }
            : t,
        ),
      }))
    }
  },

  stopScript: async (id) => {
    await stopScriptApi(id).catch(() => {})
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, scriptRunning: false } : t)),
    }))
  },

  clearScriptConsole: (id) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, scriptConsole: [] } : tab)),
    })),
}))
