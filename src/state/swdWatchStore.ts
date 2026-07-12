import { create } from 'zustand'
import {
  listElfVariables,
  onSwdVariable,
  rttUnwatchVariable,
  rttWatchVariable,
  type ElfVariable,
} from '../api/network'

export interface WatchedVariable extends ElfVariable {
  /** Latest raw bytes from the last swd://variable event — null until the
   * first successful read comes back. */
  bytes: number[] | null
}

interface SwdWatchState {
  /** ELF-declared variables available to watch, per tab — populated once
   * by loadElf, independent of which ones are actually being watched. */
  availableByTab: Record<string, ElfVariable[]>
  watchesByTab: Record<string, WatchedVariable[]>
  eventsWired: boolean

  wireEventsOnce: () => void
  loadElf: (tabId: string, path: string) => Promise<void>
  addWatch: (tabId: string, variable: ElfVariable) => Promise<void>
  removeWatch: (tabId: string, name: string) => Promise<void>
  clearTab: (tabId: string) => void
}

export const useSwdWatchStore = create<SwdWatchState>((set, get) => ({
  availableByTab: {},
  watchesByTab: {},
  eventsWired: false,

  wireEventsOnce: () => {
    if (get().eventsWired) return
    set({ eventsWired: true })
    void onSwdVariable((event) => {
      set((state) => {
        const existing = state.watchesByTab[event.id]
        if (!existing) return state
        return {
          watchesByTab: {
            ...state.watchesByTab,
            [event.id]: existing.map((w) =>
              w.name === event.name ? { ...w, bytes: event.bytes } : w,
            ),
          },
        }
      })
    })
  },

  loadElf: async (tabId, path) => {
    const variables = await listElfVariables(path)
    set((state) => ({ availableByTab: { ...state.availableByTab, [tabId]: variables } }))
  },

  addWatch: async (tabId, variable) => {
    await rttWatchVariable(tabId, variable.name, variable.address, variable.size)
    set((state) => {
      const existing = state.watchesByTab[tabId] ?? []
      if (existing.some((w) => w.name === variable.name)) return state
      return {
        watchesByTab: {
          ...state.watchesByTab,
          [tabId]: [...existing, { ...variable, bytes: null }],
        },
      }
    })
  },

  removeWatch: async (tabId, name) => {
    await rttUnwatchVariable(tabId, name)
    set((state) => ({
      watchesByTab: {
        ...state.watchesByTab,
        [tabId]: (state.watchesByTab[tabId] ?? []).filter((w) => w.name !== name),
      },
    }))
  },

  clearTab: (tabId) =>
    set((state) => {
      const availableByTab = { ...state.availableByTab }
      const watchesByTab = { ...state.watchesByTab }
      delete availableByTab[tabId]
      delete watchesByTab[tabId]
      return { availableByTab, watchesByTab }
    }),
}))
