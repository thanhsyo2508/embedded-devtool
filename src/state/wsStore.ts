import { create } from 'zustand'
import { onWsFrame, wsSendText, type WsFrameKind } from '../api/network'

export interface WsFrameRecord {
  kind: WsFrameKind
  data: number[]
  atMs: number
}

/** Capped per tab — same reasoning as udpStore's datagram cap. */
const MAX_FRAMES_PER_TAB = 500

interface WsState {
  framesByTab: Record<string, WsFrameRecord[]>
  eventsWired: boolean

  wireEventsOnce: () => void
  clearFrames: (tabId: string) => void
  sendText: (tabId: string, text: string) => Promise<void>
}

export const useWsStore = create<WsState>((set, get) => ({
  framesByTab: {},
  eventsWired: false,

  wireEventsOnce: () => {
    if (get().eventsWired) return
    set({ eventsWired: true })

    void onWsFrame((event) => {
      set((state) => {
        const existing = state.framesByTab[event.id] ?? []
        const record: WsFrameRecord = { kind: event.kind, data: event.data, atMs: Date.now() }
        return {
          framesByTab: {
            ...state.framesByTab,
            [event.id]: [...existing, record].slice(-MAX_FRAMES_PER_TAB),
          },
        }
      })
    })
  },

  clearFrames: (tabId) =>
    set((state) => {
      const next = { ...state.framesByTab }
      delete next[tabId]
      return { framesByTab: next }
    }),

  sendText: async (tabId, text) => {
    await wsSendText(tabId, text)
  },
}))
