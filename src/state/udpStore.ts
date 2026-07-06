import { create } from 'zustand'
import { onUdpDatagram } from '../api/network'

export interface UdpDatagramRecord {
  from: string
  data: number[]
  atMs: number
}

/** Capped per tab — a busy broadcast/multicast socket could otherwise grow
 * this without bound for the lifetime of a long-running tab. */
const MAX_DATAGRAMS_PER_TAB = 500

interface UdpState {
  datagramsByTab: Record<string, UdpDatagramRecord[]>
  eventsWired: boolean

  wireEventsOnce: () => void
  clearDatagrams: (tabId: string) => void
}

export const useUdpStore = create<UdpState>((set, get) => ({
  datagramsByTab: {},
  eventsWired: false,

  wireEventsOnce: () => {
    if (get().eventsWired) return
    set({ eventsWired: true })

    void onUdpDatagram((event) => {
      set((state) => {
        const existing = state.datagramsByTab[event.id] ?? []
        const record: UdpDatagramRecord = { from: event.from, data: event.data, atMs: Date.now() }
        return {
          datagramsByTab: {
            ...state.datagramsByTab,
            [event.id]: [...existing, record].slice(-MAX_DATAGRAMS_PER_TAB),
          },
        }
      })
    })
  },

  clearDatagrams: (tabId) =>
    set((state) => {
      const next = { ...state.datagramsByTab }
      delete next[tabId]
      return { datagramsByTab: next }
    }),
}))
