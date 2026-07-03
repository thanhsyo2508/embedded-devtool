import { create } from 'zustand'
import type { TabState } from './tabsStore'

const MAX_CHANNELS = 8
const MAX_POINTS = 5_000

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
  dockHeight: number
  hiddenChannels: string[]
  chartType: ChartType
  extractors: Extractor[]

  setVisible: (v: boolean) => void
  setSourceTabId: (id: string | null) => void
  setFrozen: (v: boolean) => void
  setDockHeight: (v: number) => void
  toggleChannelVisibility: (ch: string) => void
  setChartType: (t: ChartType) => void
  reset: () => void
  ingest: (tab: TabState) => void
  addExtractor: () => void
  removeExtractor: (id: string) => void
  updateExtractor: (id: string, patch: Partial<Pick<Extractor, 'pattern' | 'channel'>>) => void
  toggleExtractorEnabled: (id: string) => void
}

const emptyData = { channelOrder: [], channelData: {}, timestamps: [], lastProcessedLineSeq: -1 }

export const usePlotStore = create<PlotState>((set, get) => ({
  visible: false,
  sourceTabId: null,
  frozen: false,
  dockHeight: 280,
  hiddenChannels: [],
  chartType: 'line',
  extractors: [],
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
  setChartType: (chartType) => set({ chartType }),
  reset: () => set({ ...emptyData }),

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

  ingest: (tab) => {
    const state = get()
    if (state.frozen || state.sourceTabId !== tab.id) return
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

    for (const line of newLines) {
      const autoParsed = parseLine(line.text)
      const extracted = applyExtractors(line.text, state.extractors)
      const parsed =
        autoParsed || Object.keys(extracted).length > 0 ? { ...autoParsed, ...extracted } : null
      if (!parsed) continue

      for (const key of Object.keys(parsed)) {
        if (!channelOrder.includes(key)) {
          if (channelOrder.length >= MAX_CHANNELS) continue
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

    const overflow = timestamps.length - MAX_POINTS
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
    })
  },
}))
