import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface LibraryItem {
  id: string
  name: string
}

interface LibraryState<T extends LibraryItem> {
  items: T[]
  /** Upserts by name — saving under an existing name overwrites that entry
   * instead of creating a duplicate, matching how "Save" is expected to
   * behave for a named preset/profile. */
  save: (name: string, data: Omit<T, 'id' | 'name'>) => void
  remove: (id: string) => void
}

/** Backs the small "named list of saved X, persisted across restarts"
 * pattern shared by connection profiles, the script library, and
 * filter/trigger presets — four real call sites with identical shape. */
export function createLibraryStore<T extends LibraryItem>(storageName: string) {
  return create<LibraryState<T>>()(
    persist(
      (set) => ({
        items: [],
        save: (name, data) =>
          set((state) => {
            const existing = state.items.find((item) => item.name === name)
            const id = existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
            const item = { ...data, id, name } as T
            return {
              items: existing
                ? state.items.map((i) => (i.id === id ? item : i))
                : [...state.items, item],
            }
          }),
        remove: (id) => set((state) => ({ items: state.items.filter((i) => i.id !== id) })),
      }),
      { name: storageName },
    ),
  )
}
