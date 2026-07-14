import { create } from 'zustand'

interface PendingSearch {
  tabId: string
  query: string
  seq: number
}

interface SearchHandoffState {
  /** Set by GlobalSearchPanel when a match is picked — consumed once by the
   * target tab's MonitorView (on mount, since switching tabs unmounts the
   * previously active one) to open its search bar with the same query and
   * jump straight to the matched line. One-shot handoff, not persisted,
   * same pattern as debugHandoffStore. */
  pendingSearch: PendingSearch | null
  requestJumpToMatch: (tabId: string, query: string, seq: number) => void
  clearPendingSearch: () => void
}

export const useSearchHandoffStore = create<SearchHandoffState>((set) => ({
  pendingSearch: null,
  requestJumpToMatch: (tabId, query, seq) => set({ pendingSearch: { tabId, query, seq } }),
  clearPendingSearch: () => set({ pendingSearch: null }),
}))
