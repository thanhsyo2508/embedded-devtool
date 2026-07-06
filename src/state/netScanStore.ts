import { create } from 'zustand'
import {
  commonScanPorts,
  detectLocalSubnet,
  onNetScanDone,
  onNetScanHit,
  onNetScanHost,
  startDeepScan,
  startNetworkScan,
} from '../api/network'

const MAIN_SCAN_ID = 'netscan-main'
const DEEP_SCAN_ID = 'netscan-deep'
const TIMEOUT_MS = 400

export interface NetScanRow {
  ip: string
  mac: string | null
  name: string | null
  openPorts: Set<number>
}

interface NetScanState {
  commonPorts: [number, string][]
  cidr: string
  scanning: boolean
  rows: Record<string, NetScanRow>
  eventsWired: boolean

  deepScanIp: string | null
  deepScanFrom: number
  deepScanTo: number
  deepScanScanning: boolean
  deepScanHits: number[]

  wireEventsOnce: () => void
  loadCommonPorts: () => Promise<void>
  detectSubnet: () => Promise<void>
  setCidr: (cidr: string) => void
  startScan: () => Promise<void>
  openDeepScan: (ip: string) => void
  closeDeepScan: () => void
  setDeepScanRange: (from: number, to: number) => void
  runDeepScan: () => Promise<void>
}

function rowFor(rows: Record<string, NetScanRow>, ip: string): NetScanRow {
  return rows[ip] ?? { ip, mac: null, name: null, openPorts: new Set<number>() }
}

export const useNetScanStore = create<NetScanState>((set, get) => ({
  commonPorts: [],
  cidr: '',
  scanning: false,
  rows: {},
  eventsWired: false,

  deepScanIp: null,
  deepScanFrom: 1,
  deepScanTo: 1024,
  deepScanScanning: false,
  deepScanHits: [],

  wireEventsOnce: () => {
    if (get().eventsWired) return
    set({ eventsWired: true })

    void onNetScanHit((event) => {
      if (event.id === MAIN_SCAN_ID) {
        set((state) => {
          const row = rowFor(state.rows, event.ip)
          const openPorts = new Set(row.openPorts)
          openPorts.add(event.port)
          return { rows: { ...state.rows, [event.ip]: { ...row, openPorts } } }
        })
      } else if (event.id === DEEP_SCAN_ID) {
        set((state) => {
          const deepScanHits = [...state.deepScanHits, event.port].sort((a, b) => a - b)
          if (state.deepScanIp !== event.ip) return { deepScanHits }
          const row = rowFor(state.rows, event.ip)
          const openPorts = new Set(row.openPorts)
          openPorts.add(event.port)
          return { deepScanHits, rows: { ...state.rows, [event.ip]: { ...row, openPorts } } }
        })
      }
    })

    void onNetScanHost((event) => {
      if (event.id !== MAIN_SCAN_ID) return
      set((state) => {
        const row = rowFor(state.rows, event.ip)
        return { rows: { ...state.rows, [event.ip]: { ...row, mac: event.mac, name: event.name } } }
      })
    })

    void onNetScanDone((event) => {
      if (event.id === MAIN_SCAN_ID) set({ scanning: false })
      else if (event.id === DEEP_SCAN_ID) set({ deepScanScanning: false })
    })
  },

  loadCommonPorts: async () => {
    const commonPorts = await commonScanPorts()
    set({ commonPorts })
  },

  detectSubnet: async () => {
    try {
      const cidr = await detectLocalSubnet()
      set({ cidr })
    } catch {
      // best-effort — leave the field for the user to fill in manually
    }
  },

  setCidr: (cidr) => set({ cidr }),

  startScan: async () => {
    const { cidr, commonPorts } = get()
    if (!cidr) return
    set({ scanning: true, rows: {} })
    try {
      await startNetworkScan(
        MAIN_SCAN_ID,
        cidr,
        commonPorts.map(([port]) => port),
        TIMEOUT_MS,
      )
    } catch {
      set({ scanning: false })
    }
  },

  openDeepScan: (ip) => set({ deepScanIp: ip, deepScanHits: [] }),
  closeDeepScan: () => set({ deepScanIp: null, deepScanHits: [] }),
  setDeepScanRange: (deepScanFrom, deepScanTo) => set({ deepScanFrom, deepScanTo }),

  runDeepScan: async () => {
    const { deepScanIp, deepScanFrom, deepScanTo } = get()
    if (!deepScanIp) return
    set({ deepScanScanning: true, deepScanHits: [] })
    try {
      await startDeepScan(DEEP_SCAN_ID, deepScanIp, deepScanFrom, deepScanTo, TIMEOUT_MS)
    } catch {
      set({ deepScanScanning: false })
    }
  },
}))
