import { createLibraryStore, type LibraryItem } from './createLibraryStore'
import type { FilterRule } from './tabsStore'

export interface FilterPreset extends LibraryItem {
  filters: FilterRule[]
}

export const useFilterPresetsStore = createLibraryStore<FilterPreset>('edt-filter-presets')
