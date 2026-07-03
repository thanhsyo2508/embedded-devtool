import { create } from 'zustand'
import {
  detectEsp32Chip,
  eraseEsp32Flash,
  flashEsp32,
  loadFlashProfile,
  onFlashDone,
  onFlashProgress,
  saveFlashProfile,
  type ChipInfo,
} from '../api/flash'

// Single flash session for now — flashing one board at a time keeps the
// panel simple; the id just needs to be stable so progress/done events can
// be told apart from a future second session.
const SESSION_ID = 'flash-session'

export interface FlashSegmentRow {
  offset: string
  path: string
  label: string
}

interface FlashState {
  portName: string
  baudRate: number
  chipInfo: ChipInfo | null
  detecting: boolean
  segments: FlashSegmentRow[]
  busy: boolean
  progressCurrent: number
  progressTotal: number
  log: string[]
  eventsWired: boolean

  wireEventsOnce: () => void
  setPortName: (v: string) => void
  setBaudRate: (v: number) => void
  detectChip: () => Promise<void>
  addSegment: () => void
  removeSegment: (index: number) => void
  updateSegment: (index: number, patch: Partial<FlashSegmentRow>) => void
  flash: () => Promise<void>
  eraseFull: () => Promise<void>
  saveProfile: (path: string) => Promise<void>
  loadProfile: (path: string) => Promise<void>
}

function appendLog(state: FlashState, line: string): Pick<FlashState, 'log'> {
  return { log: [...state.log, line].slice(-200) }
}

export const useFlashStore = create<FlashState>((set, get) => ({
  portName: '',
  baudRate: 460_800,
  chipInfo: null,
  detecting: false,
  segments: [
    { offset: '0x1000', path: '', label: 'bootloader' },
    { offset: '0x8000', path: '', label: 'partitions' },
    { offset: '0x10000', path: '', label: 'app' },
  ],
  busy: false,
  progressCurrent: 0,
  progressTotal: 0,
  log: [],
  eventsWired: false,

  wireEventsOnce: () => {
    if (get().eventsWired) return
    set({ eventsWired: true })

    void onFlashProgress((event) => {
      if (event.id !== SESSION_ID) return
      set((state) => {
        if (event.phase === 'writing') {
          return { progressCurrent: event.current ?? 0, progressTotal: event.total ?? 0 }
        }
        if (event.phase === 'verifying') {
          return appendLog(state, 'Verifying…')
        }
        return appendLog(state, 'Segment done.')
      })
    })

    void onFlashDone((event) => {
      if (event.id !== SESSION_ID) return
      set((state) => ({
        busy: false,
        ...appendLog(state, event.success ? `✓ ${event.message}` : `✗ ${event.message}`),
      }))
    })
  },

  setPortName: (portName) => set({ portName, chipInfo: null }),
  setBaudRate: (baudRate) => set({ baudRate }),

  detectChip: async () => {
    const { portName } = get()
    if (!portName) return
    set((state) => ({ detecting: true, ...appendLog(state, `Detecting chip on ${portName}…`) }))
    try {
      const chipInfo = await detectEsp32Chip(portName)
      set((state) => ({
        chipInfo,
        detecting: false,
        ...appendLog(
          state,
          `✓ ${chipInfo.chip}${chipInfo.macAddress ? ` · MAC ${chipInfo.macAddress}` : ''}`,
        ),
      }))
    } catch (err) {
      set((state) => ({ detecting: false, ...appendLog(state, `✗ ${String(err)}`) }))
    }
  },

  addSegment: () =>
    set((state) => ({ segments: [...state.segments, { offset: '0x', path: '', label: '' }] })),

  removeSegment: (index) =>
    set((state) => ({ segments: state.segments.filter((_, i) => i !== index) })),

  updateSegment: (index, patch) =>
    set((state) => ({
      segments: state.segments.map((seg, i) => (i === index ? { ...seg, ...patch } : seg)),
    })),

  flash: async () => {
    const { portName, baudRate, segments } = get()
    if (!portName) return
    const parsed = segments
      .filter((s) => s.path)
      .map((s) => ({ offset: Number(s.offset), path: s.path }))
    if (parsed.length === 0) return

    set((state) => ({
      busy: true,
      progressCurrent: 0,
      progressTotal: 0,
      ...appendLog(state, `Flashing ${parsed.length} segment(s) at ${baudRate} baud…`),
    }))
    try {
      await flashEsp32(SESSION_ID, portName, baudRate, parsed)
    } catch (err) {
      set((state) => ({ busy: false, ...appendLog(state, `✗ ${String(err)}`) }))
    }
  },

  eraseFull: async () => {
    const { portName } = get()
    if (!portName) return
    set((state) => ({ busy: true, ...appendLog(state, 'Erasing entire chip…') }))
    try {
      await eraseEsp32Flash(SESSION_ID, portName)
    } catch (err) {
      set((state) => ({ busy: false, ...appendLog(state, `✗ ${String(err)}`) }))
    }
  },

  saveProfile: async (path) => {
    const { baudRate, chipInfo, segments } = get()
    await saveFlashProfile(path, {
      name: path.split(/[/\\]/).pop() ?? 'profile',
      chip: chipInfo?.chip ?? null,
      baudRate,
      segments: segments
        .filter((s) => s.path)
        .map((s) => ({ offset: Number(s.offset), path: s.path, label: s.label || null })),
    })
    set((state) => appendLog(state, `Saved profile to ${path}`))
  },

  loadProfile: async (path) => {
    const profile = await loadFlashProfile(path)
    set((state) => ({
      baudRate: profile.baudRate,
      segments: profile.segments.map((s) => ({
        offset: `0x${s.offset.toString(16)}`,
        path: s.path,
        label: s.label ?? '',
      })),
      ...appendLog(state, `Loaded profile from ${path}`),
    }))
  },
}))
