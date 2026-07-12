// Project profiles (.edtproj): a snapshot of the whole workspace — which
// tabs are open (and how they're connected), how they're arranged in the
// Snap Layout pane tree, per-tab filters/triggers/scripts, and the
// plotter's config — serialized to a JSON file so it can be reopened later
// or handed to a teammate working on the same device.
//
// Runtime tab ids are assigned fresh every time a connection is opened
// (see tabsStore's openTab), so they can't be saved as-is: the layout tree
// here uses each tab's *index* into the `tabs` array as a stable
// placeholder id instead (via layoutTree's mapTabIds), swapped back for
// real ids once the saved tabs are reopened.
import type { ChecksumMode } from './crc'
import { mapTabIds, type LayoutNode } from './layoutTree'
import type { MathChannelDef } from './plotMath'
import type { ChartType, Extractor, ThresholdLine } from '../state/plotStore'
import type {
  ConnectionConfig,
  FilterRule,
  LineEnding,
  OpenTabRequest,
  TabState,
  TriggerRule,
} from '../state/tabsStore'

export const PROJECT_PROFILE_VERSION = 1

export interface ProjectProfileTab {
  connectionConfig: ConnectionConfig
  filters: FilterRule[]
  triggers: TriggerRule[]
  scriptCode: string
  lineEnding: LineEnding
  checksumMode: ChecksumMode
}

export interface ProjectProfilePlotter {
  sourceTabIndex: number | null
  extractors: Extractor[]
  mathChannels: MathChannelDef[]
  thresholds: ThresholdLine[]
  chartType: ChartType
}

export interface ProjectProfileFile {
  version: typeof PROJECT_PROFILE_VERSION
  savedAt: number
  tabs: ProjectProfileTab[]
  /** Pane tree with tabIds as string indices ("0", "1", ...) into `tabs`,
   * not real tab ids — see module docs. */
  layout: LayoutNode
  plotter: ProjectProfilePlotter | null
}

/** Strips whatever a `ConnectionConfig` carries that shouldn't be written
 * to disk — currently just the SSH password, which the app deliberately
 * never persists anywhere (see ConnectPanel's currentConfigData); the user
 * re-enters it when the profile is reopened. MQTT's password is left as-is
 * to match how connection profiles already save it today. */
function sanitizeConnectionConfig(config: ConnectionConfig): ConnectionConfig {
  if (config.kind !== 'ssh') return config
  return { ...config, password: '' }
}

/** Builds a saveable snapshot from the live app state. `plotter` is `null`
 * when the Plotter has never been given a source (nothing meaningful to
 * restore), distinct from a plotter with an empty config. */
export function buildProjectProfile(
  tabs: TabState[],
  layoutRoot: LayoutNode,
  plotter: ProjectProfilePlotter | null,
): ProjectProfileFile {
  const idToIndex = new Map(tabs.map((tab, i) => [tab.id, String(i)]))
  return {
    version: PROJECT_PROFILE_VERSION,
    savedAt: Date.now(),
    tabs: tabs.map((tab) => ({
      connectionConfig: sanitizeConnectionConfig(tab.connectionConfig),
      filters: tab.filters,
      triggers: tab.triggers,
      scriptCode: tab.scriptCode,
      lineEnding: tab.lineEnding,
      checksumMode: tab.checksumMode,
    })),
    layout: mapTabIds(layoutRoot, (id) => idToIndex.get(id) ?? id),
    plotter,
  }
}

/** The reverse of what `openTab` does to build a `ConnectionConfig` from a
 * request — flattens a saved config back into a request `openTab` accepts,
 * under a freshly assigned `id`. `password` is only meaningful for SSH,
 * where it's re-prompted at load time rather than read from the file. */
export function connectionConfigToOpenRequest(
  config: ConnectionConfig,
  id: string,
  sshPassword?: string,
): OpenTabRequest {
  switch (config.kind) {
    case 'serial':
      return { ...config.req, kind: 'serial', id }
    case 'tcp-client':
      return { kind: 'tcp-client', id, host: config.host, port: config.port }
    case 'tcp-server':
      return { kind: 'tcp-server', id, port: config.port }
    case 'udp':
      return {
        kind: 'udp',
        id,
        localPort: config.localPort,
        remoteHost: config.remoteHost,
        remotePort: config.remotePort,
      }
    case 'ws-client':
      return { kind: 'ws-client', id, url: config.url }
    case 'ws-server':
      return { kind: 'ws-server', id, port: config.port }
    case 'mqtt':
      return { ...config, id }
    case 'ssh':
      return { ...config, id, password: sshPassword ?? '' }
    case 'rtt':
      return { ...config, id }
  }
}
