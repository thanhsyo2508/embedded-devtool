import type { ConnectionConfig, TabState } from '../state/tabsStore'

// Bounds the bundle size — the most recent lines are what a bug report needs.
const MAX_LINES_PER_TAB = 1000

const SECRET_SETTING_KEYS = new Set(['restApiToken', 'flashLockPin'])

function redactConfig(config: ConnectionConfig): ConnectionConfig {
  if (config.kind === 'ssh' || config.kind === 'mqtt') {
    return { ...config, password: config.password ? '[redacted]' : '' }
  }
  return config
}

export interface DiagnosticBundleInput {
  version: string
  platform: string
  tabs: TabState[]
  /** The settings store's state (functions and secrets are stripped). */
  settings: Record<string, unknown>
}

/** One shareable JSON snapshot for a bug report: app version, sanitized
 * settings, and each open tab's recent log + stats. Passwords and the REST
 * API token / flash PIN are redacted so the file is safe to attach to an
 * issue. */
export function buildDiagnosticBundle(input: DiagnosticBundleInput): string {
  const settings: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input.settings)) {
    if (typeof value === 'function') continue
    settings[key] = SECRET_SETTING_KEYS.has(key) ? (value ? '[redacted]' : '') : value
  }

  const tabs = input.tabs.map((tab) => ({
    label: tab.customLabel ?? tab.connectionLabel,
    kind: tab.connectionKind,
    status: tab.status,
    connectionConfig: redactConfig(tab.connectionConfig),
    stats: {
      totalLinesReceived: tab.totalLinesReceived,
      errorCount: tab.errorCount,
    },
    recentLines: tab.lines.slice(-MAX_LINES_PER_TAB).map((line) => ({
      atMs: line.atMs,
      direction: line.direction,
      text: line.text,
    })),
  }))

  return JSON.stringify(
    {
      tool: 'Embedded DevTool',
      version: input.version,
      generatedAt: new Date().toISOString(),
      platform: input.platform,
      settings,
      tabs,
    },
    null,
    2,
  )
}
