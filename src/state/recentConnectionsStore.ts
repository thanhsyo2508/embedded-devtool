import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LastConnectionConfig } from './lastConnectionStore'
import type { ConnectionKind } from './tabsStore'

export interface RecentConnection {
  id: string
  kind: ConnectionKind
  label: string
  config: LastConnectionConfig
  connectedAtMs: number
}

interface RecentConnectionsState {
  items: RecentConnection[]
  push: (kind: ConnectionKind, config: LastConnectionConfig, label: string) => void
  remove: (id: string) => void
}

const MAX_RECENT = 8

/** Auto-tracked history of the last few connections actually made, across
 * every protocol — unlike lastConnectionStore (one slot per kind, used to
 * seed the form's defaults) or connectionProfilesStore (named, manually
 * saved), this is what backs ConnectPanel's "Recent" quick-reconnect list:
 * unnamed, ordered by recency, capped. */
export const useRecentConnectionsStore = create<RecentConnectionsState>()(
  persist(
    (set) => ({
      items: [],
      push: (kind, config, label) =>
        set((state) => {
          const withoutDupe = state.items.filter(
            (item) => !(item.kind === kind && item.label === label),
          )
          const entry: RecentConnection = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            kind,
            config,
            label,
            connectedAtMs: Date.now(),
          }
          return { items: [entry, ...withoutDupe].slice(0, MAX_RECENT) }
        }),
      remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
    }),
    { name: 'edt-recent-connections' },
  ),
)
