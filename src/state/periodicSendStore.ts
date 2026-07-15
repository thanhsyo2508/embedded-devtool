import { create } from 'zustand'
import { useTabsStore } from './tabsStore'
import { parseHex } from '../lib/hex'

interface PeriodicSend {
  text: string
  isHex: boolean
  intervalMs: number
}

interface PeriodicSendState {
  /** Active repeaters per tab id — the command keeps firing on its interval
   * even after you switch to another tab (the timer lives here, not in the
   * SendPanel component, which unmounts on tab switch). */
  activeByTab: Record<string, PeriodicSend>
  start: (tabId: string, text: string, isHex: boolean, intervalMs: number) => void
  stop: (tabId: string) => void
}

// Timers are kept outside the store's reactive state — they're not something
// the UI renders, and storing a number id in zustand state would just cause
// needless re-renders.
const timers: Record<string, ReturnType<typeof setInterval>> = {}

/** Returns false when the tab is gone (closed), signalling the caller to
 * tear the repeater down; skips (but keeps running) while merely
 * disconnected, so a reconnect resumes the heartbeat. */
function fire(tabId: string, entry: PeriodicSend): boolean {
  const tab = useTabsStore.getState().tabs.find((tb) => tb.id === tabId)
  if (!tab) return false
  if (tab.status !== 'open') return true
  if (entry.isHex) {
    const bytes = parseHex(entry.text)
    if (bytes) void useTabsStore.getState().sendBytes(tabId, bytes, entry.text, true)
  } else {
    void useTabsStore.getState().send(tabId, entry.text)
  }
  return true
}

export const usePeriodicSendStore = create<PeriodicSendState>((set) => ({
  activeByTab: {},
  start: (tabId, text, isHex, intervalMs) => {
    clearInterval(timers[tabId])
    const entry: PeriodicSend = { text, isHex, intervalMs: Math.max(50, intervalMs) }
    // Fire immediately so the first tick isn't a full interval away, then
    // repeat on the interval, tearing down if the tab is closed.
    fire(tabId, entry)
    timers[tabId] = setInterval(() => {
      if (!fire(tabId, entry)) usePeriodicSendStore.getState().stop(tabId)
    }, entry.intervalMs)
    set((state) => ({ activeByTab: { ...state.activeByTab, [tabId]: entry } }))
  },
  stop: (tabId) => {
    clearInterval(timers[tabId])
    delete timers[tabId]
    set((state) => {
      const next = { ...state.activeByTab }
      delete next[tabId]
      return { activeByTab: next }
    })
  },
}))
