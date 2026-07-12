import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ProductionDeviceType = 'esp32' | 'stm32'

export interface ProductionHistoryEntry {
  id: string
  atMs: number
  deviceType: ProductionDeviceType
  port: string
  success: boolean
  message: string
  /** The serial/MAC/key value injected for this device, if this entry
   * came from STM32 Mass Production rather than a plain batch flash. */
  provisionedValue?: string
}

interface ProductionHistoryState {
  entries: ProductionHistoryEntry[]
  addEntry: (entry: Omit<ProductionHistoryEntry, 'id' | 'atMs'>) => void
  clear: () => void
}

// Capped rather than unbounded — this is a rolling production log, not an
// audit trail meant to grow forever in localStorage.
const MAX_ENTRIES = 5000

/** Cross-session record of devices flashed by a *production* workflow —
 * ESP32 batch flash (including auto-flash-on-plug) and STM32 Mass
 * Production, not ad-hoc single-device flashes during development, so
 * the stats this backs (ProductionStatsPanel) stay meaningful for
 * "how many units did we ship" rather than counting every test flash. */
export const useProductionHistoryStore = create<ProductionHistoryState>()(
  persist(
    (set) => ({
      entries: [],
      addEntry: (entry) =>
        set((state) => ({
          entries: [
            {
              ...entry,
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              atMs: Date.now(),
            },
            ...state.entries,
          ].slice(0, MAX_ENTRIES),
        })),
      clear: () => set({ entries: [] }),
    }),
    { name: 'edt-production-history' },
  ),
)
