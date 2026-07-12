import { create } from 'zustand'

interface DebugHandoffState {
  /** Set by the monitor's right-click "Decode as crash backtrace" action;
   * consumed once by FlashPanel (to default its target to the Debug tab)
   * and DebugPanel (to seed its backtrace textarea), then cleared — a
   * one-shot handoff, not persisted state. */
  pendingBacktraceText: string | null
  requestBacktraceDecode: (text: string) => void
  clearPendingBacktraceText: () => void
}

export const useDebugHandoffStore = create<DebugHandoffState>((set) => ({
  pendingBacktraceText: null,
  requestBacktraceDecode: (text) => set({ pendingBacktraceText: text }),
  clearPendingBacktraceText: () => set({ pendingBacktraceText: null }),
}))
