import {
  useConnectionProfilesStore,
  type ConnectionProfile,
} from '../state/connectionProfilesStore'
import { useFilterPresetsStore, type FilterPreset } from '../state/filterPresetsStore'
import { useMqttPresetsStore, type MqttPreset } from '../state/mqttPresetsStore'
import { usePluginLibraryStore, type InstalledPlugin } from '../state/pluginLibraryStore'
import {
  useQuickCommandProfilesStore,
  type QuickCommandProfile,
} from '../state/quickCommandProfilesStore'
import { useScriptLibraryStore, type SavedScript } from '../state/scriptLibraryStore'
import { useTriggerPresetsStore, type TriggerPreset } from '../state/triggerPresetsStore'

const BUNDLE_VERSION = 1

/** Every "saved library" in one portable file — connection profiles,
 * scripts, plugins, quick-command profiles, and filter/trigger presets —
 * for backing up or handing a teammate the same setup instead of
 * recreating it by hand. Deliberately excludes personal preferences
 * (settingsStore: theme/language/REST API token) and auto-tracked,
 * unnamed state (recent connections, toast/production history) — those
 * aren't "configuration" in the sense someone would want to share. */
export interface ConfigBundle {
  version: number
  exportedAtMs: number
  connectionProfiles: ConnectionProfile[]
  filterPresets: FilterPreset[]
  mqttPresets: MqttPreset[]
  plugins: InstalledPlugin[]
  quickCommandProfiles: QuickCommandProfile[]
  scripts: SavedScript[]
  triggerPresets: TriggerPreset[]
}

export function buildConfigBundle(): ConfigBundle {
  return {
    version: BUNDLE_VERSION,
    exportedAtMs: Date.now(),
    connectionProfiles: useConnectionProfilesStore.getState().items,
    filterPresets: useFilterPresetsStore.getState().items,
    mqttPresets: useMqttPresetsStore.getState().items,
    plugins: usePluginLibraryStore.getState().items,
    quickCommandProfiles: useQuickCommandProfilesStore.getState().items,
    scripts: useScriptLibraryStore.getState().items,
    triggerPresets: useTriggerPresetsStore.getState().items,
  }
}

export interface ImportSummary {
  connectionProfiles: number
  filterPresets: number
  mqttPresets: number
  plugins: number
  quickCommandProfiles: number
  scripts: number
  triggerPresets: number
}

// Every library's `save(name, data)` already upserts by name (see
// createLibraryStore) — importing is just calling it once per item, which
// naturally overwrites a same-named local entry rather than duplicating it.
function importItems<T extends { id: string; name: string }>(
  items: T[] | undefined,
  save: (name: string, data: Omit<T, 'id' | 'name'>) => void,
): number {
  if (!items) return 0
  for (const item of items) {
    save(item.name, item)
  }
  return items.length
}

export function importConfigBundle(bundle: ConfigBundle): ImportSummary {
  return {
    connectionProfiles: importItems(
      bundle.connectionProfiles,
      useConnectionProfilesStore.getState().save,
    ),
    filterPresets: importItems(bundle.filterPresets, useFilterPresetsStore.getState().save),
    mqttPresets: importItems(bundle.mqttPresets, useMqttPresetsStore.getState().save),
    plugins: importItems(bundle.plugins, usePluginLibraryStore.getState().save),
    quickCommandProfiles: importItems(
      bundle.quickCommandProfiles,
      useQuickCommandProfilesStore.getState().save,
    ),
    scripts: importItems(bundle.scripts, useScriptLibraryStore.getState().save),
    triggerPresets: importItems(bundle.triggerPresets, useTriggerPresetsStore.getState().save),
  }
}
