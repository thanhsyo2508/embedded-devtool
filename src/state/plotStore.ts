import { create } from 'zustand'
import type { TabState } from './tabsStore'
import type { FftWindow } from '../lib/fft'
import type { MathChannelDef } from '../lib/plotMath'
import { useSettingsStore } from './settingsStore'
import { useToastStore } from './toastStore'
import i18n from '../i18n'

const MAX_CHANNELS = 8

/// Tries key:value / key=value pairs first (handles Arduino-plotter-style
/// "temp:24.5,hum:51.2" and free-form "temp=24.5 hum=51.2" logging equally);
/// falls back to plain CSV/space-separated numbers positioned as ch1, ch2…
/// Returns null for lines that are neither — most serial output is plain
/// text, not data, and that's expected, not an error.
function parseLine(text: string): Record<string, number> | null {
  const kvRegex = /([a-zA-Z_]\w*)\s*[:=]\s*(-?\d+\.?\d*)/g
  const kv: Record<string, number> = {}
  let match: RegExpExecArray | null
  while ((match = kvRegex.exec(text))) {
    kv[match[1]] = Number.parseFloat(match[2])
  }
  if (Object.keys(kv).length > 0) return kv

  const tokens = text
    .trim()
    .split(/[,\s]+/)
    .filter(Boolean)
  if (tokens.length === 0) return null
  const nums = tokens.map(Number)
  if (nums.some((n) => Number.isNaN(n))) return null

  const positional: Record<string, number> = {}
  nums.forEach((n, i) => {
    positional[`ch${i + 1}`] = n
  })
  return positional
}

export type ChartType = 'line' | 'area' | 'step' | 'bars' | 'points'

// M4.1: user-defined "temp=(\d+\.\d+)" -> channel "temp" style mappings,
// applied on top of parseLine's generic auto-detect so values buried in
// otherwise-plain log text can still reach the plotter.
export interface Extractor {
  id: string
  pattern: string
  channel: string
  enabled: boolean
}

/** Horizontal alert level drawn over the chart; crossing it upward beeps. */
export interface ThresholdLine {
  id: string
  enabled: boolean
  channel: string
  value: number
}

/** A single JSON field, picked from one MQTT topic's payload, watched for
 * plotting. Matching is by exact topic string only (never a subscription
 * wildcard), and `channel` is always topic-qualified — see `addMqttField` —
 * so two topics that happen to publish a same-named field (e.g. both have
 * "temp") can never land on the same chart channel. */
export interface MqttFieldWatch {
  id: string
  topic: string
  path: string
  channel: string
  enabled: boolean
}

function applyExtractors(text: string, extractors: Extractor[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const extractor of extractors) {
    if (!extractor.enabled || extractor.channel.length === 0) continue
    let match: RegExpExecArray | null
    try {
      match = new RegExp(extractor.pattern).exec(text)
    } catch {
      continue
    }
    if (!match || match[1] === undefined) continue
    const value = Number.parseFloat(match[1])
    if (!Number.isNaN(value)) result[extractor.channel] = value
  }
  return result
}

interface PlotState {
  visible: boolean
  sourceTabId: string | null
  frozen: boolean
  channelOrder: string[]
  channelData: Record<string, (number | null)[]>
  timestamps: number[]
  lastProcessedLineSeq: number
  /** Set once a new channel gets silently dropped for hitting MAX_CHANNELS,
   * so the one-time toast (see `warnChannelLimit`) doesn't refire on every
   * following data tick — cleared whenever the chart itself is cleared. */
  channelLimitWarned: boolean
  dockHeight: number
  hiddenChannels: string[]
  /** Per-channel colour overrides, keyed by channel name. A channel not
   * listed here falls back to its position in the default palette (see
   * PlotDock). Keyed by name (not index) so a channel keeps its colour
   * even as others come and go. */
  channelColors: Record<string, string>
  chartType: ChartType
  extractors: Extractor[]
  mathChannels: MathChannelDef[]
  thresholds: ThresholdLine[]
  mqttFields: MqttFieldWatch[]
  fftMode: boolean
  fftWindow: FftWindow
  showStats: boolean

  setVisible: (v: boolean) => void
  setSourceTabId: (id: string | null) => void
  setFrozen: (v: boolean) => void
  setDockHeight: (v: number) => void
  toggleChannelVisibility: (ch: string) => void
  setChannelColor: (ch: string, color: string) => void
  setChartType: (t: ChartType) => void
  setFftMode: (v: boolean) => void
  setFftWindow: (w: FftWindow) => void
  setShowStats: (v: boolean) => void
  reset: () => void
  /** Restores a saved project profile's plotter config (source tab,
   * extractors, math channels, thresholds, chart type) — no plotted data,
   * that repopulates once the source tab reconnects and starts ingesting. */
  loadConfig: (config: {
    sourceTabId: string | null
    extractors: Extractor[]
    mathChannels: MathChannelDef[]
    thresholds: ThresholdLine[]
    chartType: ChartType
    channelColors?: Record<string, string>
    mqttFields?: MqttFieldWatch[]
  }) => void
  ingest: (tab: TabState) => void
  ingestScriptPoint: (streamId: string, channel: string, value: number) => void
  addExtractor: () => void
  removeExtractor: (id: string) => void
  updateExtractor: (id: string, patch: Partial<Pick<Extractor, 'pattern' | 'channel'>>) => void
  toggleExtractorEnabled: (id: string) => void
  addMathChannel: () => void
  removeMathChannel: (id: string) => void
  updateMathChannel: (id: string, patch: Partial<Omit<MathChannelDef, 'id'>>) => void
  toggleMathChannelEnabled: (id: string) => void
  addThreshold: () => void
  removeThreshold: (id: string) => void
  updateThreshold: (id: string, patch: Partial<Omit<ThresholdLine, 'id'>>) => void
  toggleThresholdEnabled: (id: string) => void
  /** No-op if this exact topic+path is already watched — lets the "add to
   * plot" button in the MQTT payload view be called unconditionally. */
  addMqttField: (topic: string, path: string) => void
  removeMqttField: (id: string) => void
  toggleMqttFieldEnabled: (id: string) => void
}

// `lastProcessedLineSeq` is deliberately NOT part of this — it only marks
// how far into the source tab's own (unrelated, never-cleared-by-Plot) line
// buffer `ingest` has already consumed. Rewinding it to -1 makes `ingest`
// treat every line still sitting in that buffer as new again, so a source
// switch (which really does need a from-scratch replay) uses `emptyData`
// below, while the user-facing "Clear" button uses this bare shape instead
// — clearing the chart shouldn't also replay everything the source tab
// happens to still have buffered from before the clear.
const emptyChartData = {
  channelOrder: [],
  channelData: {},
  timestamps: [],
  channelLimitWarned: false,
}
const emptyData = { ...emptyChartData, lastProcessedLineSeq: -1 }

export const usePlotStore = create<PlotState>((set, get) => ({
  visible: false,
  sourceTabId: null,
  frozen: false,
  dockHeight: 280,
  hiddenChannels: [],
  channelColors: {},
  chartType: 'line',
  extractors: [],
  mathChannels: [],
  thresholds: [],
  mqttFields: [],
  fftMode: false,
  fftWindow: 'hann',
  showStats: false,
  ...emptyData,

  setVisible: (visible) => set({ visible }),
  setSourceTabId: (sourceTabId) => set({ sourceTabId, hiddenChannels: [], ...emptyData }),
  setFrozen: (frozen) => set({ frozen }),
  setDockHeight: (dockHeight) => set({ dockHeight: Math.max(120, Math.min(dockHeight, 900)) }),
  toggleChannelVisibility: (ch) =>
    set((state) => ({
      hiddenChannels: state.hiddenChannels.includes(ch)
        ? state.hiddenChannels.filter((c) => c !== ch)
        : [...state.hiddenChannels, ch],
    })),
  setChannelColor: (ch, color) =>
    set((state) => ({ channelColors: { ...state.channelColors, [ch]: color } })),
  setChartType: (chartType) => set({ chartType }),
  setFftMode: (fftMode) => set({ fftMode }),
  setFftWindow: (fftWindow) => set({ fftWindow }),
  setShowStats: (showStats) => set({ showStats }),
  reset: () => set({ ...emptyChartData }),

  loadConfig: ({
    sourceTabId,
    extractors,
    mathChannels,
    thresholds,
    chartType,
    channelColors,
    mqttFields,
  }) =>
    set({
      sourceTabId,
      extractors,
      mathChannels,
      thresholds,
      chartType,
      channelColors: channelColors ?? {},
      mqttFields: mqttFields ?? [],
      hiddenChannels: [],
      ...emptyData,
    }),

  addExtractor: () =>
    set((state) => ({
      extractors: [
        ...state.extractors,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          pattern: '',
          channel: '',
          enabled: true,
        },
      ],
    })),

  removeExtractor: (id) =>
    set((state) => ({ extractors: state.extractors.filter((e) => e.id !== id) })),

  updateExtractor: (id, patch) =>
    set((state) => ({
      extractors: state.extractors.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })),

  toggleExtractorEnabled: (id) =>
    set((state) => ({
      extractors: state.extractors.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)),
    })),

  addMathChannel: () =>
    set((state) => ({
      mathChannels: [
        ...state.mathChannels,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          enabled: true,
          label: `math${state.mathChannels.length + 1}`,
          op: 'movingAvg' as const,
          sourceA: state.channelOrder[0] ?? '',
          window: 10,
        },
      ],
    })),

  removeMathChannel: (id) =>
    set((state) => ({ mathChannels: state.mathChannels.filter((m) => m.id !== id) })),

  updateMathChannel: (id, patch) =>
    set((state) => ({
      mathChannels: state.mathChannels.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),

  toggleMathChannelEnabled: (id) =>
    set((state) => ({
      mathChannels: state.mathChannels.map((m) =>
        m.id === id ? { ...m, enabled: !m.enabled } : m,
      ),
    })),

  addThreshold: () =>
    set((state) => ({
      thresholds: [
        ...state.thresholds,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          enabled: true,
          channel: state.channelOrder[0] ?? '',
          value: 0,
        },
      ],
    })),

  removeThreshold: (id) =>
    set((state) => ({ thresholds: state.thresholds.filter((t) => t.id !== id) })),

  updateThreshold: (id, patch) =>
    set((state) => ({
      thresholds: state.thresholds.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  toggleThresholdEnabled: (id) =>
    set((state) => ({
      thresholds: state.thresholds.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)),
    })),

  addMqttField: (topic, path) =>
    set((state) => {
      if (state.mqttFields.some((f) => f.topic === topic && f.path === path)) return state
      return {
        mqttFields: [
          ...state.mqttFields,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            topic,
            path,
            channel: `${topic}:${path}`,
            enabled: true,
          },
        ],
      }
    }),

  removeMqttField: (id) =>
    set((state) => ({ mqttFields: state.mqttFields.filter((f) => f.id !== id) })),

  toggleMqttFieldEnabled: (id) =>
    set((state) => ({
      mqttFields: state.mqttFields.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f)),
    })),

  ingest: (tab) => {
    const state = get()
    if (state.frozen || state.sourceTabId !== tab.id) return
    // MQTT tabs also get a raw "topic: payload" line per message (for the
    // Raw log view), which this generic key:number regex would otherwise
    // auto-parse into noisy, uncontrolled channels — exactly the "which
    // line is which parameter" problem the MQTT field picker (mqttFields,
    // fed via ingestScriptPoint from mqttStore) exists to solve properly.
    // Once that picker exists, MQTT data should only ever reach the chart
    // through it, never through this generic fallback.
    if (tab.connectionKind === 'mqtt') return
    const newLines = tab.lines.filter((l) => l.seq > state.lastProcessedLineSeq)
    if (newLines.length === 0) return

    const channelOrder = [...state.channelOrder]
    const channelData: Record<string, (number | null)[]> = {}
    for (const ch of channelOrder) channelData[ch] = [...state.channelData[ch]]
    const timestamps = [...state.timestamps]
    const lastValues: Record<string, number | null> = {}
    for (const ch of channelOrder) {
      const arr = channelData[ch]
      lastValues[ch] = arr.length > 0 ? arr[arr.length - 1] : null
    }
    let channelLimitWarned = state.channelLimitWarned

    for (const line of newLines) {
      const autoParsed = parseLine(line.text)
      const extracted = applyExtractors(line.text, state.extractors)
      const parsed =
        autoParsed || Object.keys(extracted).length > 0 ? { ...autoParsed, ...extracted } : null
      if (!parsed) continue

      for (const key of Object.keys(parsed)) {
        if (!channelOrder.includes(key)) {
          if (channelOrder.length >= MAX_CHANNELS) {
            if (!channelLimitWarned) {
              channelLimitWarned = true
              useToastStore
                .getState()
                .addToast('error', i18n.t('plot.channelLimitReached', { max: MAX_CHANNELS }))
            }
            continue
          }
          channelOrder.push(key)
          channelData[key] = new Array(timestamps.length).fill(null)
          lastValues[key] = null
        }
        lastValues[key] = parsed[key]
      }

      timestamps.push(line.atMs)
      for (const ch of channelOrder) {
        if (!channelData[ch]) channelData[ch] = new Array(timestamps.length - 1).fill(null)
        const hasChannel = Object.prototype.hasOwnProperty.call(parsed, ch)
        channelData[ch].push(hasChannel ? parsed[ch] : lastValues[ch])
      }
    }

    const overflow = timestamps.length - useSettingsStore.getState().plotMaxPoints
    const trimmedTimestamps = overflow > 0 ? timestamps.slice(overflow) : timestamps
    const trimmedChannelData: Record<string, (number | null)[]> = {}
    for (const ch of channelOrder) {
      trimmedChannelData[ch] = overflow > 0 ? channelData[ch].slice(overflow) : channelData[ch]
    }

    set({
      channelOrder,
      channelData: trimmedChannelData,
      timestamps: trimmedTimestamps,
      lastProcessedLineSeq: newLines[newLines.length - 1].seq,
      channelLimitWarned,
    })
  },

  // A script's plot(channel, value) call feeds into the chart the same way
  // an auto-parsed log line would, but only when the plotter's selected
  // source tab is the one the script is attached to — no separate "script"
  // source needed in the UI.
  ingestScriptPoint: (streamId, channel, value) => {
    const state = get()
    if (state.frozen || state.sourceTabId !== streamId) return

    const channelOrder = [...state.channelOrder]
    if (!channelOrder.includes(channel)) {
      if (channelOrder.length >= MAX_CHANNELS) {
        if (!state.channelLimitWarned) {
          set({ channelLimitWarned: true })
          useToastStore
            .getState()
            .addToast('error', i18n.t('plot.channelLimitReached', { max: MAX_CHANNELS }))
        }
        return
      }
      channelOrder.push(channel)
    }

    const channelData: Record<string, (number | null)[]> = {}
    for (const ch of channelOrder) {
      channelData[ch] = state.channelData[ch]
        ? [...state.channelData[ch]]
        : new Array(state.timestamps.length).fill(null)
    }

    const timestamps = [...state.timestamps, Date.now()]
    for (const ch of channelOrder) {
      const arr = channelData[ch]
      arr.push(ch === channel ? value : (arr[arr.length - 1] ?? null))
    }

    const overflow = timestamps.length - useSettingsStore.getState().plotMaxPoints
    const trimmedTimestamps = overflow > 0 ? timestamps.slice(overflow) : timestamps
    const trimmedChannelData: Record<string, (number | null)[]> = {}
    for (const ch of channelOrder) {
      trimmedChannelData[ch] = overflow > 0 ? channelData[ch].slice(overflow) : channelData[ch]
    }

    set({ channelOrder, channelData: trimmedChannelData, timestamps: trimmedTimestamps })
  },
}))
