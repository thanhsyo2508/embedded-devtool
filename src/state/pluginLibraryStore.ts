import { createLibraryStore, type LibraryItem } from './createLibraryStore'
import type { PluginKind } from '../api/plugin'

export interface InstalledPlugin extends LibraryItem {
  version: string
  description: string
  kind: PluginKind
  code: string
}

/** Installed plugins (decoder/plotter-parser), persisted the same way as
 * the script library / connection profiles / quick-command profiles — a
 * plugin is just named, reusable Lua source plus the manifest fields
 * parsed out of it (see lib/pluginManifest.ts), not a separate package
 * format on disk. */
export const usePluginLibraryStore = createLibraryStore<InstalledPlugin>('plugin-library')
