import { createLibraryStore, type LibraryItem } from './createLibraryStore'
import type { TriggerRule } from './tabsStore'

export interface TriggerPreset extends LibraryItem {
  triggers: TriggerRule[]
}

export const useTriggerPresetsStore = createLibraryStore<TriggerPreset>('edt-trigger-presets')
