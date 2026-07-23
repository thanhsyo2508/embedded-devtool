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
import {
  closeNetworkStream,
  onNetworkData,
  openMqtt,
  openRtt,
  openSsh,
  openTcpClient,
  openTcpServer,
  openUdp,
  openWsClient,
  openWsServer,
  writeNetworkStream,
  type MqttParams,
} from '../api/network'
import { sftpDisconnect } from '../api/sftp'
import { ftpConnect, ftpDisconnect } from '../api/ftp'
import { useSftpStore } from './sftpStore'
import { useFtpTreeStore } from './ftpTreeStore'
import { useSshTerminalsStore } from './sshTerminalsStore'
import i18n from '../i18n'
import { useSettingsStore, type Encoding, type NewlineMode } from './settingsStore'
import { detectLogLevel, type LogLevel } from '../lib/logLevel'
import { matchTriggers } from '../lib/triggers'
import { parseHex, formatHex } from '../lib/hex'
import { applyChecksum, type ChecksumMode } from '../lib/crc'
import {
  buildExceptionResponse,
  buildRequest,
  buildResponseFrame,
  parseRequestFrame,
  parseResponseFrame,
  READ_FUNCTION_CODES,
  type ModbusFunctionCode,
  type ModbusRequestFrame,
  type ModbusResponseFrame,
} from '../lib/modbus'
import { ModbusFrameAssembler } from '../lib/modbusFrameAssembler'
import { parseTcpResponseFrame, rtuToTcp } from '../lib/modbusTcp'
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
import {
  onPluginDecoded,
  onPluginDone,
  onPluginError,
  onPluginPlot,
  pluginRun,
  pluginStop,
  type PluginKind,
} from '../api/plugin'
import type { InstalledPlugin } from './pluginLibraryStore'
import { usePlotStore } from './plotStore'

export interface LogLine {
  seq: number
  atMs: number
  bytes: number[]
  text: string
  level: LogLevel | null
  /** 'tx' for a line the Send panel/quick command/macro/script wrote out,
   * 'rx' for everything read back from the device — lets the monitor show
   * both directions in one buffer instead of only what came in. */
  direction: 'rx' | 'tx'
}

export type FilterMode = 'include' | 'exclude'

export interface FilterRule {
  id: string
  pattern: string
  mode: FilterMode
  enabled: boolean
}

/** A regex → colour rule: any log line matching `pattern` is tinted with
 * `color` in the monitor, on top of (and overriding) the automatic
 * log-level colouring. First matching enabled rule wins. */
export interface ColorRule {
  id: string
  pattern: string
  color: string
  enabled: boolean
}

/** A named regex whose live match count and rate the monitor tracks — for
 * "how many resets / CRC errors / retries has this device logged, and how
 * fast", without writing a script. */
export interface EventCounter {
  id: string
  pattern: string
  label: string
  enabled: boolean
}

export type TriggerActionType = 'send' | 'sound' | 'file' | 'bookmark' | 'webhook'

export interface TriggerAction {
  type: TriggerActionType
  sendText: string
  sendIsHex: boolean
  filePath: string
  /** For the `webhook` action: the URL to POST to, and an optional JSON body
   * template. `{{line}}` / `{{pattern}}` in the body are substituted with the
   * matched line text and the rule's pattern; an empty body sends a default
   * `{ "line": ..., "pattern": ... }` object. Optional so triggers saved
   * before this action existed still parse. */
  webhookUrl?: string
  webhookBody?: string
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

/** One installed plugin attached to this tab. Unlike a script (one slot
 * per tab, imperative), a tab can have several plugins active at once,
 * each a pure decode(line)/parse(line) function the backend calls
 * automatically — `fields`/`error` reflect the plugin's most recent line,
 * not a running console log. */
export interface ActivePlugin {
  runId: string
  pluginId: string
  name: string
  kind: PluginKind
  running: boolean
  error: string | null
  fields: Record<string, string>
}

export interface ModbusLogEntry {
  kind: 'sent' | 'received' | 'timeout' | 'error'
  message: string
  atMs: number
}

export type ModbusRegisterKind = 'coils' | 'discreteInputs' | 'holdingRegisters' | 'inputRegisters'

export interface ModbusSlaveState {
  enabled: boolean
  slaveAddr: number
  // Stored as plain numbers (0/1 for coils/discreteInputs) rather than
  // booleans so every kind shares one Record<number, number> shape — a
  // mixed boolean/number value type would make the single generic
  // setModbusRegister/removeModbusRegister actions below type-unsafe.
  coils: Record<number, number>
  discreteInputs: Record<number, number>
  holdingRegisters: Record<number, number>
  inputRegisters: Record<number, number>
  log: ModbusLogEntry[]
}

/** A repeating master-side read, run by the sequential scheduler in
 * `tickModbusPolls` — write function codes aren't valid here since polling
 * a write doesn't make sense. */
export interface ModbusPollRule {
  id: string
  enabled: boolean
  label: string
  slaveAddr: number
  functionCode: ModbusFunctionCode
  startAddr: number
  quantity: number
  intervalMs: number
  /** Set after each tick so the poll row can show its own outcome inline,
   * without the operator having to scan the shared request/response log. */
  lastResult?: { atMs: number; ok: boolean; text: string }
}

export type ViewMode = 'mixed' | 'hex' | 'ascii'
export type TimestampMode = 'delta' | 'abs' | 'off'
export type LineEnding = 'none' | 'cr' | 'lf' | 'crlf'
export type TabStatus = 'open' | 'closed' | 'error'
export type ConnectionKind =
  | 'serial'
  | 'tcp-client'
  | 'tcp-server'
  | 'udp'
  | 'ws-client'
  | 'ws-server'
  | 'mqtt'
  | 'ssh'
  | 'ftp'
  | 'rtt'

/** What a tab connects over — serial keeps the full `OpenPortRequest` (data
 * bits/parity/etc.), TCP only needs host/port. Kept around so Reconnect can
 * reopen with the exact same settings instead of making the user re-enter
 * everything. SSH's password lives here (in-memory only, never persisted —
 * unlike ConnectionProfile/lastConnectionStore, TabState never touches
 * localStorage) purely so Reconnect works without re-prompting mid-session. */
export type ConnectionConfig =
  | { kind: 'serial'; req: OpenPortRequest }
  | { kind: 'tcp-client'; host: string; port: number }
  | { kind: 'tcp-server'; port: number }
  | { kind: 'udp'; localPort: number; remoteHost?: string; remotePort?: number }
  | { kind: 'ws-client'; url: string }
  | { kind: 'ws-server'; port: number }
  | ({ kind: 'mqtt' } & MqttParams)
  | {
      kind: 'ssh'
      host: string
      port: number
      username: string
      password: string
      privateKeyPath?: string
      passphrase?: string
    }
  | { kind: 'ftp'; host: string; port: number; username: string; password: string }
  | { kind: 'rtt'; probeSerial?: string; chip: string }

/** What `openTab` accepts to start a new connection of any kind. `id` is
 * always the caller-assigned tab id (also used as the underlying stream id). */
export type OpenTabRequest =
  | ({ kind: 'serial' } & OpenPortRequest)
  | { kind: 'tcp-client'; id: string; host: string; port: number }
  | { kind: 'tcp-server'; id: string; port: number }
  | {
      kind: 'udp'
      id: string
      localPort: number
      remoteHost?: string
      remotePort?: number
    }
  | { kind: 'ws-client'; id: string; url: string }
  | { kind: 'ws-server'; id: string; port: number }
  | ({ kind: 'mqtt'; id: string } & MqttParams)
  | {
      kind: 'ssh'
      id: string
      host: string
      port: number
      username: string
      password: string
      privateKeyPath?: string
      passphrase?: string
    }
  | { kind: 'ftp'; id: string; host: string; port: number; username: string; password: string }
  | { kind: 'rtt'; id: string; probeSerial?: string; chip: string }

export interface TabState {
  id: string
  connectionKind: ConnectionKind
  /** Human-readable "COM3 · 115200" / "192.168.1.5:8080" / ":8080 (server)",
   * used anywhere a tab needs a one-line label (tab strip, plotter source
   * picker) instead of each display spot re-deriving it per connection kind. */
  connectionLabel: string
  /** A user-chosen name shown instead of `connectionLabel` when set (via the
   * tab's right-click Rename) — for telling apart three "COM3 · 115200" tabs
   * as "Sensor board" / "Gateway" / etc. Persists in a project profile. */
  customLabel?: string
  /** Optional per-tab color dot and emoji shown in the tab strip, for
   * quicker visual identification when several similar tabs are open.
   * Both persist in a project profile. */
  tabColor?: string
  tabEmoji?: string
  portName: string
  baudRate: number
  status: TabStatus
  errorMessage?: string
  connectionConfig: ConnectionConfig
  lines: LogLine[]
  pendingBytes: number[]
  pendingAtMs: number | null
  firstLineAtMs: number | null
  nextSeq: number
  viewMode: ViewMode
  timestampMode: TimestampMode
  lineEnding: LineEnding
  /** When not 'none', `sendBytes` appends the checksum for this mode and
   * suppresses the line-ending append (a trailing CR/LF after a CRC would
   * corrupt a binary frame like Modbus RTU). */
  checksumMode: ChecksumMode
  sendHistory: string[]
  isLogging: boolean
  logDir?: string
  /** When set, the monitor view freezes on lines up to this seq — new data
   * keeps arriving and accumulating in `lines` underneath, nothing is lost,
   * only the displayed view stops moving until resumed. */
  pausedAtSeq: number | null
  filters: FilterRule[]
  colorRules: ColorRule[]
  eventCounters: EventCounter[]
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
  activePlugins: ActivePlugin[]
  modbusMasterLog: ModbusLogEntry[]
  modbusMasterPolls: ModbusPollRule[]
  modbusSlave: ModbusSlaveState
  /** Which saved quick-command profile (see quickCommandProfilesStore) this
   * tab currently shows in its Quick Commands bar. Not persisted — like
   * viewMode/timestampMode, it resets to "none picked" for a fresh tab. */
  quickCommandProfileId: string | null
}

interface TabsStore {
  tabs: TabState[]
  activeTabId: string | null
  eventsWired: boolean

  wireEventsOnce: () => void
  openTab: (req: OpenTabRequest) => Promise<void>
  closeTab: (id: string) => Promise<void>
  disconnectTab: (id: string) => Promise<void>
  /** `sshPasswordOverride` lets an SSH tab reconnect with a freshly typed
   * password (e.g. after a wrong-password disconnect) instead of the one
   * remembered from when the tab was first opened — every other kind
   * ignores it. On success the tab's remembered password is updated too,
   * so a *later* reconnect (e.g. from the tab context menu) uses it. */
  reconnectTab: (id: string, sshPasswordOverride?: string) => Promise<void>
  /** Sets (or clears, on empty string) the tab's user-chosen display name. */
  renameTab: (id: string, label: string) => void
  /** Sets (or clears, on empty string) the tab's color dot / emoji. */
  setTabColor: (id: string, color: string) => void
  setTabEmoji: (id: string, emoji: string) => void
  setActiveTab: (id: string) => void
  setViewMode: (id: string, mode: ViewMode) => void
  setTimestampMode: (id: string, mode: TimestampMode) => void
  setLineEnding: (id: string, ending: LineEnding) => void
  setChecksumMode: (id: string, mode: ChecksumMode) => void
  setQuickCommandProfile: (id: string, profileId: string | null) => void
  send: (id: string, text: string, lineEndingOverride?: LineEnding) => Promise<void>
  sendBytes: (
    id: string,
    bytes: number[],
    historyEntry: string,
    isHex?: boolean,
    lineEndingOverride?: LineEnding,
  ) => Promise<void>
  toggleLogging: (id: string) => Promise<void>
  flushStaleTabs: () => void
  clearLines: (id: string) => void
  togglePause: (id: string) => void
  addFilter: (id: string, mode: FilterMode) => void
  /** Same as `addFilter`, pre-populated with a pattern — the monitor's
   * right-click "Add as filter" quick action uses this so the selected
   * text becomes a ready-to-use filter in one step instead of add-then-type. */
  addFilterWithPattern: (id: string, mode: FilterMode, pattern: string) => void
  removeFilter: (id: string, filterId: string) => void
  updateFilterPattern: (id: string, filterId: string, pattern: string) => void
  toggleFilterEnabled: (id: string, filterId: string) => void
  setFilters: (id: string, filters: FilterRule[]) => void
  addColorRule: (id: string) => void
  removeColorRule: (id: string, ruleId: string) => void
  updateColorRule: (
    id: string,
    ruleId: string,
    patch: Partial<Pick<ColorRule, 'pattern' | 'color'>>,
  ) => void
  toggleColorRuleEnabled: (id: string, ruleId: string) => void
  setColorRules: (id: string, colorRules: ColorRule[]) => void
  addEventCounter: (id: string) => void
  removeEventCounter: (id: string, counterId: string) => void
  updateEventCounter: (
    id: string,
    counterId: string,
    patch: Partial<Pick<EventCounter, 'pattern' | 'label'>>,
  ) => void
  toggleEventCounterEnabled: (id: string, counterId: string) => void
  setEventCounters: (id: string, eventCounters: EventCounter[]) => void
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
  togglePlugin: (id: string, plugin: InstalledPlugin) => Promise<void>
  appendModbusMasterLog: (id: string, kind: ModbusLogEntry['kind'], message: string) => void
  clearModbusMasterLog: (id: string) => void
  /** Shared by the manual request builder and the poll scheduler so the two
   * can never talk over each other on the same (half-duplex) bus — see
   * module-level `modbusRuntimes`. Returns null on timeout, on a write
   * error, or if the bus is already busy with another request. */
  sendModbusRequest: (
    id: string,
    slaveAddr: number,
    functionCode: ModbusFunctionCode,
    startAddr: number,
    quantityOrValue: number,
    values: number[] | undefined,
    timeoutMs: number,
  ) => Promise<ModbusResponseFrame | null>
  tickModbusPolls: () => void
  addModbusPoll: (id: string) => void
  removeModbusPoll: (id: string, pollId: string) => void
  updateModbusPoll: (id: string, pollId: string, patch: Partial<Omit<ModbusPollRule, 'id'>>) => void
  toggleModbusPollEnabled: (id: string, pollId: string) => void
  setModbusSlaveEnabled: (id: string, enabled: boolean) => void
  setModbusSlaveAddress: (id: string, slaveAddr: number) => void
  setModbusRegister: (id: string, kind: ModbusRegisterKind, addr: number, value: number) => void
  removeModbusRegister: (id: string, kind: ModbusRegisterKind, addr: number) => void
  appendModbusSlaveLog: (id: string, kind: ModbusLogEntry['kind'], message: string) => void
  clearModbusSlaveLog: (id: string) => void
}

export const LINE_ENDING_BYTES: Record<LineEnding, number[]> = {
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
      direction: 'rx',
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
      direction: 'rx',
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
    direction: 'rx',
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

function connectionLabelFor(config: ConnectionConfig): string {
  switch (config.kind) {
    case 'serial':
      return `${config.req.portName} · ${config.req.baudRate}`
    case 'tcp-client':
      return `${config.host}:${config.port}`
    case 'tcp-server':
      return `:${config.port} (server)`
    case 'udp':
      return config.remoteHost
        ? `UDP :${config.localPort} → ${config.remoteHost}:${config.remotePort}`
        : `UDP :${config.localPort}`
    case 'ws-client':
      return config.url
    case 'ws-server':
      return `:${config.port} (WS server)`
    case 'mqtt':
      return `mqtt://${config.brokerHost}:${config.brokerPort}`
    case 'ssh':
      return `${config.username}@${config.host}:${config.port}`
    case 'ftp':
      return `ftp://${config.username}@${config.host}:${config.port}`
    case 'rtt':
      return `SWD · ${config.chip}`
  }
}

// Trigger sends/bookmarks go through the same store actions a user would
// trigger by hand, but with historyEntry '' so they don't pollute send
// history or get captured into an in-progress macro recording (see
// sendBytes below) — only sends a person actually typed should do that.
async function dispatchTriggerAction(
  tabId: string,
  action: TriggerAction,
  pattern: string,
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
    case 'webhook': {
      const url = action.webhookUrl ?? ''
      if (url.length === 0) return
      const template = action.webhookBody ?? ''
      // Substitute JSON-escaped values so `{{line}}` inside a body like
      // {"text":"{{line}}"} stays valid JSON; an empty template sends a
      // default object with the matched line and rule pattern.
      const body =
        template.length > 0
          ? template
              .split('{{line}}')
              .join(JSON.stringify(line.text).slice(1, -1))
              .split('{{pattern}}')
              .join(JSON.stringify(pattern).slice(1, -1))
          : JSON.stringify({ line: line.text, pattern })
      // Fire-and-forget on the backend (own thread) so a slow/unreachable
      // endpoint never stalls data handling.
      await invoke('trigger_webhook', { url, body })
      break
    }
  }
}

async function runTriggers(tab: TabState, lines: LogLine[], get: () => TabsStore): Promise<void> {
  const matches = matchTriggers(tab.triggers, lines)
  for (const { rule, line } of matches) {
    try {
      await dispatchTriggerAction(tab.id, rule.action, rule.pattern, line, get)
    } catch {
      // best-effort — one bad trigger action shouldn't block the rest
    }
  }
}

// Modbus request/response bookkeeping deliberately lives outside zustand's
// reactive state, keyed by tab id — it's ephemeral wiring (in-flight
// promises, byte assemblers), not user-facing data, and must survive the
// Master/Slave panels being unmounted (their sidebar flyout closed, or the
// user switched to a different one) exactly like triggers/filters already
// keep matching in the background regardless of which panel is open, since
// that logic also lives in this same always-running event pipeline rather
// than inside a component.
interface ModbusRuntime {
  assembler: ModbusFrameAssembler<ModbusResponseFrame> | null
  slaveAssembler: ModbusFrameAssembler<ModbusRequestFrame> | null
  pending: {
    functionCode: ModbusFunctionCode
    resolve: (frame: ModbusResponseFrame | null) => void
  } | null
  pollBusy: boolean
  lastPolledAtMs: Map<string, number>
  /** Modbus TCP MBAP transaction id counter (unused for serial/RTU tabs). */
  nextTransactionId: number
}

const modbusRuntimes = new Map<string, ModbusRuntime>()

function getModbusRuntime(tabId: string): ModbusRuntime {
  let runtime = modbusRuntimes.get(tabId)
  if (!runtime) {
    runtime = {
      assembler: null,
      slaveAssembler: null,
      pending: null,
      pollBusy: false,
      lastPolledAtMs: new Map(),
      nextTransactionId: 1,
    }
    modbusRuntimes.set(tabId, runtime)
  }
  return runtime
}

/** Which register map a given function code reads/writes. Discrete inputs
 * (0x02) and input registers (0x04) have no write function code in the
 * spec — they only ever appear here via a read. */
function kindForModbusFunctionCode(functionCode: ModbusFunctionCode): ModbusRegisterKind {
  switch (functionCode) {
    case 0x01:
    case 0x05:
    case 0x0f:
      return 'coils'
    case 0x02:
      return 'discreteInputs'
    case 0x04:
      return 'inputRegisters'
    case 0x03:
    case 0x06:
    case 0x10:
      return 'holdingRegisters'
  }
}

const MODBUS_ILLEGAL_DATA_ADDRESS = 0x02

/** Applies an incoming request against `slave`'s register maps and returns
 * the response bytes to send back, plus a short log line — pure logic, no
 * store/IPC access, so the central pipeline and any future caller can reuse
 * it identically. */
function respondToModbusRequest(
  slave: ModbusSlaveState,
  frame: ModbusRequestFrame,
  setRegister: (kind: ModbusRegisterKind, addr: number, value: number) => void,
): { response: number[]; log: string; isException: boolean } {
  const kind = kindForModbusFunctionCode(frame.functionCode)
  const map = slave[kind]

  if (READ_FUNCTION_CODES.includes(frame.functionCode)) {
    const values: number[] = []
    for (let i = 0; i < frame.quantity; i++) {
      const value = map[frame.startAddr + i]
      if (value === undefined) {
        return {
          response: buildExceptionResponse(
            slave.slaveAddr,
            frame.functionCode,
            MODBUS_ILLEGAL_DATA_ADDRESS,
          ),
          log: `Sent exception 0x02 (illegal data address ${frame.startAddr + i})`,
          isException: true,
        }
      }
      values.push(value)
    }
    return {
      response: buildResponseFrame(
        slave.slaveAddr,
        frame.functionCode,
        frame.startAddr,
        frame.quantity,
        values,
      ),
      log: `Sent values: ${values.join(', ')}`,
      isException: false,
    }
  }

  // Writes (0x05/0x06/0x0F/0x10): apply then echo, per spec.
  frame.values.forEach((v, i) => setRegister(kind, frame.startAddr + i, v))
  return {
    response: buildResponseFrame(
      slave.slaveAddr,
      frame.functionCode,
      frame.startAddr,
      frame.quantity,
      frame.values,
    ),
    log: `Wrote ${frame.values.length} value(s) at ${frame.startAddr}`,
    isException: false,
  }
}

/** Feeds one raw byte batch into whichever Modbus role is active for this
 * tab — resolving an in-flight master request's response, and/or acting as
 * the slave emulator if `modbusSlave.enabled`. Called from
 * `handleIncomingData` unconditionally (not gated on whether any text
 * "line" completed), since Modbus RTU frames are binary and have no
 * newline framing to key off. */
function handleModbusBytes(tab: TabState, data: number[], get: () => TabsStore): void {
  const runtime = getModbusRuntime(tab.id)

  if (runtime.pending && runtime.assembler) {
    const frames = runtime.assembler.push(data)
    if (frames.length > 0 && runtime.pending) {
      runtime.pending.resolve(frames[0])
      runtime.pending = null
    }
  }

  if (!tab.modbusSlave.enabled) return
  if (!runtime.slaveAssembler) {
    runtime.slaveAssembler = new ModbusFrameAssembler<ModbusRequestFrame>(parseRequestFrame)
  }
  const requests = runtime.slaveAssembler.push(data)
  for (const request of requests) {
    if (request.slaveAddr !== tab.modbusSlave.slaveAddr) {
      get().appendModbusSlaveLog(
        tab.id,
        'received',
        `Ignored request for slave ${request.slaveAddr} (not us)`,
      )
      continue
    }
    const { response, log, isException } = respondToModbusRequest(
      tab.modbusSlave,
      request,
      (kind, addr, value) => get().setModbusRegister(tab.id, kind, addr, value),
    )
    get().appendModbusSlaveLog(
      tab.id,
      'received',
      `RX fn=0x${request.functionCode.toString(16).padStart(2, '0')} addr=${request.startAddr} qty=${request.quantity}`,
    )
    const write = tab.connectionKind === 'serial' ? writeSerialPort : writeNetworkStream
    void write(tab.id, response)
    get().appendModbusSlaveLog(tab.id, isException ? 'error' : 'sent', log)
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
    setInterval(() => get().tickModbusPolls(), 200)

    // Shared by onSerialData/onNetworkData below — a tab's id is all either
    // event source is keyed by, so incoming bytes are handled identically
    // regardless of transport.
    const handleIncomingData = (batch: { id: string; data: number[] }) => {
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

      const tab = get().tabs.find((t) => t.id === batch.id)
      if (tab) handleModbusBytes(tab, batch.data, get)

      if (newLines.length === 0) return
      if (tab && tab.triggers.length > 0) void runTriggers(tab, newLines, get)
    }

    void onSerialData(handleIncomingData)
    void onNetworkData(handleIncomingData)

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

    // Plugin events are keyed by runId (`${tabId}:${pluginId}`), unique
    // across every tab, so each handler maps over every tab's
    // activePlugins looking for the one matching entry rather than
    // needing to parse the tab id back out of the run id.
    const updateActivePlugin = (runId: string, patch: Partial<ActivePlugin>) =>
      set((state) => ({
        tabs: state.tabs.map((tab) => ({
          ...tab,
          activePlugins: tab.activePlugins.map((p) => (p.runId === runId ? { ...p, ...patch } : p)),
        })),
      }))

    void onPluginDecoded((e) => updateActivePlugin(e.id, { fields: e.fields, error: null }))
    void onPluginPlot((e) => {
      updateActivePlugin(e.id, { error: null })
      usePlotStore.getState().ingestScriptPoint(e.streamId, e.channel, e.value)
    })
    void onPluginError((e) => updateActivePlugin(e.id, { error: e.message }))
    void onPluginDone((e) => updateActivePlugin(e.id, { running: false }))
  },

  openTab: async (req) => {
    const connectionConfig: ConnectionConfig =
      req.kind === 'serial'
        ? { kind: 'serial', req }
        : req.kind === 'tcp-client'
          ? { kind: 'tcp-client', host: req.host, port: req.port }
          : req.kind === 'tcp-server'
            ? { kind: 'tcp-server', port: req.port }
            : req.kind === 'udp'
              ? {
                  kind: 'udp',
                  localPort: req.localPort,
                  remoteHost: req.remoteHost,
                  remotePort: req.remotePort,
                }
              : req.kind === 'ws-client'
                ? { kind: 'ws-client', url: req.url }
                : req.kind === 'ws-server'
                  ? { kind: 'ws-server', port: req.port }
                  : req.kind === 'mqtt'
                    ? {
                        kind: 'mqtt',
                        brokerHost: req.brokerHost,
                        brokerPort: req.brokerPort,
                        clientId: req.clientId,
                        username: req.username,
                        password: req.password,
                        subscribeTopic: req.subscribeTopic,
                        publishTopic: req.publishTopic,
                      }
                    : req.kind === 'ssh'
                      ? {
                          kind: 'ssh',
                          host: req.host,
                          port: req.port,
                          username: req.username,
                          password: req.password,
                          privateKeyPath: req.privateKeyPath,
                          passphrase: req.passphrase,
                        }
                      : req.kind === 'ftp'
                        ? {
                            kind: 'ftp',
                            host: req.host,
                            port: req.port,
                            username: req.username,
                            password: req.password,
                          }
                        : { kind: 'rtt', probeSerial: req.probeSerial, chip: req.chip }

    const newTab: TabState = {
      id: req.id,
      connectionKind: req.kind,
      connectionLabel: connectionLabelFor(connectionConfig),
      portName: req.kind === 'serial' ? req.portName : '',
      baudRate: req.kind === 'serial' ? req.baudRate : 0,
      status: 'open',
      connectionConfig,
      lines: [],
      pendingBytes: [],
      pendingAtMs: null,
      firstLineAtMs: null,
      nextSeq: 0,
      viewMode: 'ascii',
      timestampMode: 'off',
      lineEnding: 'crlf',
      checksumMode: 'none',
      sendHistory: [],
      isLogging: false,
      pausedAtSeq: null,
      filters: [],
      colorRules: [],
      eventCounters: [],
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
      activePlugins: [],
      modbusMasterLog: [],
      modbusMasterPolls: [],
      modbusSlave: {
        enabled: false,
        slaveAddr: 1,
        coils: {},
        discreteInputs: {},
        holdingRegisters: {},
        inputRegisters: {},
        log: [],
      },
      quickCommandProfileId: null,
    }
    // Attempt the connection before the tab ever appears in the strip —
    // a failed *initial* connect (bad port, host unreachable, port already
    // bound) should surface as an error in ConnectPanel, not swap the user
    // into a broken tab. Once open, later drops are a different case
    // (see reconnectTab) and legitimately show as an 'error' status tab.
    if (req.kind === 'serial') await openSerialPort(req)
    else if (req.kind === 'tcp-client') await openTcpClient(req.id, req.host, req.port)
    else if (req.kind === 'tcp-server') await openTcpServer(req.id, req.port)
    else if (req.kind === 'udp')
      await openUdp(req.id, req.localPort, req.remoteHost, req.remotePort)
    else if (req.kind === 'ws-client') await openWsClient(req.id, req.url)
    else if (req.kind === 'ws-server') await openWsServer(req.id, req.port)
    else if (req.kind === 'mqtt') await openMqtt(req.id, req)
    else if (req.kind === 'ssh')
      await openSsh(
        req.id,
        req.host,
        req.port,
        req.username,
        req.password,
        req.privateKeyPath,
        req.passphrase,
      )
    else if (req.kind === 'ftp')
      await ftpConnect(req.id, req.host, req.port, req.username, req.password)
    else await openRtt(req.id, req.probeSerial, req.chip)

    set((state) => ({ tabs: [...state.tabs, newTab], activeTabId: newTab.id }))
  },

  closeTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (tab?.connectionKind === 'ssh') {
      const session = useSftpStore.getState().sessions[id]
      const hasUnsavedEdits = session?.openFiles.some((f) => f.content !== f.originalContent)
      if (hasUnsavedEdits && !window.confirm(i18n.t('ssh.sftp.closeTabUnsavedConfirm'))) {
        return
      }
    }
    if (tab?.connectionKind === 'ftp') {
      const session = useFtpTreeStore.getState().sessions[id]
      const hasUnsavedEdits = session?.openFiles.some((f) => f.content !== f.originalContent)
      if (hasUnsavedEdits && !window.confirm(i18n.t('ftp.tree.closeTabUnsavedConfirm'))) {
        return
      }
    }
    if (tab?.scriptRunning) {
      await stopScriptApi(id).catch(() => {})
    }
    await Promise.all(
      (tab?.activePlugins ?? [])
        .filter((p) => p.running)
        .map((p) => pluginStop(p.runId).catch(() => {})),
    )
    if (tab?.connectionKind === 'serial') await closeSerialPort(id).catch(() => {})
    else if (tab?.connectionKind === 'ftp') await ftpDisconnect(id).catch(() => {})
    else await closeNetworkStream(id).catch(() => {})
    if (tab?.connectionKind === 'ssh') {
      await sftpDisconnect(id).catch(() => {})
      useSftpStore.getState().disposeSession(id)
      await useSshTerminalsStore.getState().disposeSession(id)
    }
    if (tab?.connectionKind === 'ftp') {
      useFtpTreeStore.getState().disposeSession(id)
    }
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== id)
      const activeTabId = state.activeTabId === id ? (tabs[0]?.id ?? null) : state.activeTabId
      return { tabs, activeTabId }
    })
  },

  // Stops the underlying connection but keeps the tab (and its buffered
  // log, filters, triggers, script) around — unlike closeTab, which removes
  // the tab entirely. Lets Reconnect below bring the same tab back to life.
  disconnectTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (tab?.scriptRunning) {
      await stopScriptApi(id).catch(() => {})
    }
    await Promise.all(
      (tab?.activePlugins ?? [])
        .filter((p) => p.running)
        .map((p) => pluginStop(p.runId).catch(() => {})),
    )
    if (tab?.connectionKind === 'serial') await closeSerialPort(id).catch(() => {})
    else if (tab?.connectionKind === 'ftp') await ftpDisconnect(id).catch(() => {})
    else await closeNetworkStream(id).catch(() => {})
    if (tab?.connectionKind === 'ssh') {
      await useSftpStore.getState().disconnectSession(id)
      await useSshTerminalsStore.getState().disposeSession(id)
    }
    if (tab?.connectionKind === 'ftp') {
      useFtpTreeStore.getState().disconnectSession(id)
    }
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              status: 'closed',
              errorMessage: undefined,
              activePlugins: tab.activePlugins.map((p) => ({ ...p, running: false })),
            }
          : tab,
      ),
    }))
  },

  // Mirrors openTab: success flips this tab to 'open' via the
  // serial://lifecycle listener in wireEventsOnce, not here directly.
  reconnectTab: async (id, sshPasswordOverride) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    try {
      const config = tab.connectionConfig
      if (config.kind === 'serial') await openSerialPort(config.req)
      else if (config.kind === 'tcp-client') await openTcpClient(id, config.host, config.port)
      else if (config.kind === 'tcp-server') await openTcpServer(id, config.port)
      else if (config.kind === 'udp')
        await openUdp(id, config.localPort, config.remoteHost, config.remotePort)
      else if (config.kind === 'ws-client') await openWsClient(id, config.url)
      else if (config.kind === 'ws-server') await openWsServer(id, config.port)
      else if (config.kind === 'mqtt') await openMqtt(id, config)
      else if (config.kind === 'ssh') {
        const password = sshPasswordOverride ?? config.password
        await openSsh(
          id,
          config.host,
          config.port,
          config.username,
          password,
          config.privateKeyPath,
          config.passphrase,
        )
        if (sshPasswordOverride !== undefined) {
          set((state) => ({
            tabs: state.tabs.map((t) =>
              t.id === id && t.connectionConfig.kind === 'ssh'
                ? { ...t, connectionConfig: { ...t.connectionConfig, password } }
                : t,
            ),
          }))
        }
      } else if (config.kind === 'ftp') {
        await ftpConnect(id, config.host, config.port, config.username, config.password)
        // Same reasoning as ensureConnected's own doc comment: this is the
        // tab's one and only FTP connection, already redialed above, so the
        // tree store just needs telling it's back — not a second dial.
        useFtpTreeStore.getState().ensureConnected(id, config)
      } else await openRtt(id, config.probeSerial, config.chip)
    } catch (err) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id ? { ...t, status: 'error', errorMessage: String(err) } : t,
        ),
      }))
    }
  },

  renameTab: (id, label) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, customLabel: label.trim() || undefined } : tab,
      ),
    })),

  setTabColor: (id, color) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, tabColor: color || undefined } : tab,
      ),
    })),

  setTabEmoji: (id, emoji) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, tabEmoji: emoji || undefined } : tab,
      ),
    })),

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

  setChecksumMode: (id, mode) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, checksumMode: mode } : tab)),
    })),

  setQuickCommandProfile: (id, profileId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, quickCommandProfileId: profileId } : tab,
      ),
    })),

  send: async (id, text, lineEndingOverride) => {
    await get().sendBytes(
      id,
      Array.from(new TextEncoder().encode(text)),
      text,
      false,
      lineEndingOverride,
    )
  },

  sendBytes: async (id, bytes, historyEntry, isHex = false, lineEndingOverride) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    // A checksummed frame (e.g. Modbus RTU) must not get a trailing CR/LF
    // appended after its checksum, so line ending is suppressed whenever a
    // checksum is active rather than relying on the user to remember to set
    // Line Ending to "None" themselves.
    const withChecksum = applyChecksum(bytes, tab.checksumMode)
    const outgoing =
      tab.checksumMode === 'none'
        ? [...withChecksum, ...LINE_ENDING_BYTES[lineEndingOverride ?? tab.lineEnding]]
        : withChecksum
    if (tab.connectionKind === 'serial') await writeSerialPort(id, outgoing)
    else await writeNetworkStream(id, outgoing)
    const now = Date.now()
    // Echo what was actually written (including any appended checksum) as
    // its own 'tx' line so the monitor shows both directions, not just what
    // came back — atMs uses performance.now() to share the same clock base
    // as received lines (see appendBytesToTab), so delta timestamps line up.
    const { encoding, maxLinesPerTab } = useSettingsStore.getState()
    const atMs = performance.now()
    const txText = bytesToText(outgoing, encoding)
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== id) return t
        const txLine: LogLine = {
          seq: t.nextSeq,
          atMs,
          bytes: outgoing,
          text: txText,
          level: null,
          direction: 'tx',
        }
        const mergedLines = [...t.lines, txLine]
        const trimmedLines =
          mergedLines.length > maxLinesPerTab
            ? mergedLines.slice(mergedLines.length - maxLinesPerTab)
            : mergedLines
        const withTx = {
          ...t,
          lines: trimmedLines,
          nextSeq: t.nextSeq + 1,
          firstLineAtMs: t.firstLineAtMs ?? atMs,
        }
        if (historyEntry.length === 0) return withTx
        // Re-sending something already in history moves it to the front
        // instead of adding a duplicate, so repeating a command doesn't
        // bury older distinct ones behind a run of identical entries that
        // Up-arrow would otherwise have to step through one at a time.
        const withHistory = {
          ...withTx,
          sendHistory: [
            historyEntry,
            ...withTx.sendHistory.filter((entry) => entry !== historyEntry),
          ].slice(0, 100),
        }
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

  addFilterWithPattern: (id, mode, pattern) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              filters: [
                ...tab.filters,
                {
                  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  pattern,
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

  // Seeded with a readable default colour rather than an empty string so a
  // fresh rule tints something the moment a pattern is typed.
  addColorRule: (id) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              colorRules: [
                ...tab.colorRules,
                {
                  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  pattern: '',
                  color: '#e0a030',
                  enabled: true,
                },
              ],
            }
          : tab,
      ),
    })),

  removeColorRule: (id, ruleId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, colorRules: tab.colorRules.filter((r) => r.id !== ruleId) } : tab,
      ),
    })),

  updateColorRule: (id, ruleId, patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              colorRules: tab.colorRules.map((r) => (r.id === ruleId ? { ...r, ...patch } : r)),
            }
          : tab,
      ),
    })),

  toggleColorRuleEnabled: (id, ruleId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              colorRules: tab.colorRules.map((r) =>
                r.id === ruleId ? { ...r, enabled: !r.enabled } : r,
              ),
            }
          : tab,
      ),
    })),

  setColorRules: (id, colorRules) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              colorRules: colorRules.map((r) => ({
                ...r,
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              })),
            }
          : tab,
      ),
    })),

  addEventCounter: (id) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              eventCounters: [
                ...tab.eventCounters,
                {
                  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  pattern: '',
                  label: '',
                  enabled: true,
                },
              ],
            }
          : tab,
      ),
    })),

  removeEventCounter: (id, counterId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? { ...tab, eventCounters: tab.eventCounters.filter((c) => c.id !== counterId) }
          : tab,
      ),
    })),

  updateEventCounter: (id, counterId, patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              eventCounters: tab.eventCounters.map((c) =>
                c.id === counterId ? { ...c, ...patch } : c,
              ),
            }
          : tab,
      ),
    })),

  toggleEventCounterEnabled: (id, counterId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              eventCounters: tab.eventCounters.map((c) =>
                c.id === counterId ? { ...c, enabled: !c.enabled } : c,
              ),
            }
          : tab,
      ),
    })),

  setEventCounters: (id, eventCounters) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              eventCounters: eventCounters.map((c) => ({
                ...c,
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

  // Unlike scripts (one code slot per tab), several plugins can run on the
  // same tab at once — each entry in activePlugins is its own decode/parse
  // loop on the backend, keyed by `${tabId}:${pluginId}` so the same
  // installed plugin can also run on a different tab simultaneously.
  togglePlugin: async (id, plugin) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    const runId = `${id}:${plugin.id}`
    const existing = tab.activePlugins.find((p) => p.runId === runId)

    if (existing?.running) {
      await pluginStop(runId).catch(() => {})
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id
            ? {
                ...t,
                activePlugins: t.activePlugins.map((p) =>
                  p.runId === runId ? { ...p, running: false } : p,
                ),
              }
            : t,
        ),
      }))
      return
    }

    try {
      await pluginRun(runId, id, plugin.kind, plugin.code)
    } catch (err) {
      window.alert(String(err))
      return
    }
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== id) return t
        const entry: ActivePlugin = {
          runId,
          pluginId: plugin.id,
          name: plugin.name,
          kind: plugin.kind,
          running: true,
          error: null,
          fields: {},
        }
        const activePlugins = existing
          ? t.activePlugins.map((p) => (p.runId === runId ? entry : p))
          : [...t.activePlugins, entry]
        return { ...t, activePlugins }
      }),
    }))
  },

  appendModbusMasterLog: (id, kind, message) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              modbusMasterLog: [...tab.modbusMasterLog, { kind, message, atMs: Date.now() }].slice(
                -200,
              ),
            }
          : tab,
      ),
    })),

  clearModbusMasterLog: (id) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, modbusMasterLog: [] } : tab)),
    })),

  sendModbusRequest: async (
    id,
    slaveAddr,
    functionCode,
    startAddr,
    quantityOrValue,
    values,
    timeoutMs,
  ) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return null
    const runtime = getModbusRuntime(id)
    if (runtime.pending) {
      get().appendModbusMasterLog(id, 'error', 'Bus busy with another Modbus request — try again')
      return null
    }
    // Framing follows the tab's transport: MBAP-wrapped Modbus TCP over a
    // TCP Client tab, classic RTU (addr + CRC) over serial. A tab's kind
    // never changes, so the lazily created assembler can pick its parser
    // once.
    const isTcp = tab.connectionKind === 'tcp-client'
    if (!runtime.assembler) {
      runtime.assembler = new ModbusFrameAssembler<ModbusResponseFrame>((bytes) => {
        if (!runtime.pending) return { status: 'incomplete' }
        return isTcp
          ? parseTcpResponseFrame(runtime.pending.functionCode, bytes)
          : parseResponseFrame(runtime.pending.functionCode, bytes)
      })
    }
    runtime.assembler.reset()

    const rtuRequest = buildRequest(slaveAddr, functionCode, startAddr, quantityOrValue, values)
    const request = isTcp ? rtuToTcp(rtuRequest, runtime.nextTransactionId++ & 0xffff) : rtuRequest
    get().appendModbusMasterLog(id, 'sent', `TX ${formatHex(request)}`)

    const responsePromise = new Promise<ModbusResponseFrame | null>((resolve) => {
      runtime.pending = { functionCode, resolve }
    })
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs)
    })

    try {
      if (tab.connectionKind === 'serial') await writeSerialPort(id, request)
      else await writeNetworkStream(id, request)
    } catch (err) {
      runtime.pending = null
      get().appendModbusMasterLog(id, 'error', String(err))
      return null
    }

    const result = await Promise.race([responsePromise, timeoutPromise])
    runtime.pending = null

    if (result === null) {
      get().appendModbusMasterLog(
        id,
        'timeout',
        `Timed out after ${timeoutMs}ms waiting for a response`,
      )
    } else if (result.isException) {
      get().appendModbusMasterLog(
        id,
        'error',
        `Slave returned exception 0x${result.exceptionCode.toString(16).padStart(2, '0')}`,
      )
    } else {
      get().appendModbusMasterLog(id, 'received', `RX values: ${result.values.join(', ')}`)
    }
    return result
  },

  // Runs on the same ~200ms tick as flushStaleTabs. RS485 only allows one
  // transaction in flight on the bus at a time, so this finds at most one
  // due rule per tab per tick and shares sendModbusRequest's own `pending`
  // gate with the manual request builder — the two can never overlap.
  tickModbusPolls: () => {
    const now = Date.now()
    for (const tab of get().tabs) {
      if (tab.status !== 'open' || tab.modbusSlave.enabled) continue
      const runtime = getModbusRuntime(tab.id)
      if (runtime.pending || runtime.pollBusy) continue
      const due = tab.modbusMasterPolls.find((rule) => {
        if (!rule.enabled) return false
        const last = runtime.lastPolledAtMs.get(rule.id) ?? 0
        return now - last >= rule.intervalMs
      })
      if (!due) continue
      runtime.lastPolledAtMs.set(due.id, now)
      runtime.pollBusy = true
      void get()
        .sendModbusRequest(
          tab.id,
          due.slaveAddr,
          due.functionCode,
          due.startAddr,
          due.quantity,
          undefined,
          1000,
        )
        .then((result) => {
          if (result === null) {
            get().updateModbusPoll(tab.id, due.id, {
              lastResult: { atMs: Date.now(), ok: false, text: 'Timed out' },
            })
            return
          }
          if (result.isException) {
            get().updateModbusPoll(tab.id, due.id, {
              lastResult: {
                atMs: Date.now(),
                ok: false,
                text: `Exception 0x${result.exceptionCode.toString(16).padStart(2, '0')}`,
              },
            })
            return
          }
          get().updateModbusPoll(tab.id, due.id, {
            lastResult: { atMs: Date.now(), ok: true, text: result.values.join(', ') },
          })
          if (result.values.length > 0) {
            usePlotStore.getState().ingestScriptPoint(tab.id, due.label, result.values[0])
          }
        })
        .finally(() => {
          runtime.pollBusy = false
        })
    }
  },

  addModbusPoll: (id) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              modbusMasterPolls: [
                ...tab.modbusMasterPolls,
                {
                  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  enabled: true,
                  label: `poll${tab.modbusMasterPolls.length + 1}`,
                  slaveAddr: 1,
                  functionCode: 0x03 as ModbusFunctionCode,
                  startAddr: 0,
                  quantity: 1,
                  intervalMs: 1000,
                },
              ],
            }
          : tab,
      ),
    })),

  removeModbusPoll: (id, pollId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? { ...tab, modbusMasterPolls: tab.modbusMasterPolls.filter((p) => p.id !== pollId) }
          : tab,
      ),
    })),

  updateModbusPoll: (id, pollId, patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              modbusMasterPolls: tab.modbusMasterPolls.map((p) =>
                p.id === pollId ? { ...p, ...patch } : p,
              ),
            }
          : tab,
      ),
    })),

  toggleModbusPollEnabled: (id, pollId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              modbusMasterPolls: tab.modbusMasterPolls.map((p) =>
                p.id === pollId ? { ...p, enabled: !p.enabled } : p,
              ),
            }
          : tab,
      ),
    })),

  setModbusSlaveEnabled: (id, enabled) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, modbusSlave: { ...tab.modbusSlave, enabled } } : tab,
      ),
    })),

  setModbusSlaveAddress: (id, slaveAddr) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, modbusSlave: { ...tab.modbusSlave, slaveAddr } } : tab,
      ),
    })),

  setModbusRegister: (id, kind, addr, value) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              modbusSlave: {
                ...tab.modbusSlave,
                [kind]: { ...tab.modbusSlave[kind], [addr]: value },
              },
            }
          : tab,
      ),
    })),

  removeModbusRegister: (id, kind, addr) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== id) return tab
        const rest = { ...tab.modbusSlave[kind] }
        delete rest[addr]
        return { ...tab, modbusSlave: { ...tab.modbusSlave, [kind]: rest } }
      }),
    })),

  appendModbusSlaveLog: (id, kind, message) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              modbusSlave: {
                ...tab.modbusSlave,
                log: [...tab.modbusSlave.log, { kind, message, atMs: Date.now() }].slice(-200),
              },
            }
          : tab,
      ),
    })),

  clearModbusSlaveLog: (id) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, modbusSlave: { ...tab.modbusSlave, log: [] } } : tab,
      ),
    })),
}))
