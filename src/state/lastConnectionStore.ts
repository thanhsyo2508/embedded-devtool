import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ConnectionProfile } from './connectionProfilesStore'
import type { ConnectionKind } from './tabsStore'

export type LastConnectionConfig = Omit<ConnectionProfile, 'id' | 'name'>

interface LastConnectionState {
  /** Which protocol kind was connected last overall — used to restore the
   * connect form's family/role selection, not just its field values. */
  lastKind: ConnectionKind | null
  byKind: Partial<Record<ConnectionKind, LastConnectionConfig>>
  remember: (kind: ConnectionKind, config: LastConnectionConfig) => void
}

/** Remembers the most recent connection config actually used for each
 * protocol kind, persisted across restarts — so reopening the connect form
 * shows what you last connected with instead of resetting to hardcoded
 * defaults every time. Separate from connectionProfilesStore's named,
 * user-curated profiles: this is automatic, unnamed, and updated on every
 * successful connect. */
export const useLastConnectionStore = create<LastConnectionState>()(
  persist(
    (set) => ({
      lastKind: null,
      byKind: {},
      remember: (kind, config) =>
        set((state) => ({ lastKind: kind, byKind: { ...state.byKind, [kind]: config } })),
    }),
    { name: 'edt-last-connection' },
  ),
)
