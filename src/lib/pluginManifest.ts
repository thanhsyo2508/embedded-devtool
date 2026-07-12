import type { PluginKind } from '../api/plugin'

export interface PluginManifest {
  name: string
  version: string
  description: string
  kind: PluginKind
}

export interface ParsedPlugin {
  manifest: PluginManifest
  code: string
}

const HEADER_LINE = /^--\s*([a-zA-Z]+):\s*(.*)$/
const KIND_ALIASES: Record<string, PluginKind> = {
  decoder: 'decoder',
  plotter: 'plotterParser',
  'plotter-parser': 'plotterParser',
  plotterparser: 'plotterParser',
}

/** Parses a plugin's manifest out of its leading `-- key: value` comment
 * lines — the first blank or non-matching line ends the header. No
 * separate manifest file, so installing a plugin is just picking one
 * `.lua` file (see docs/HelpGuide's Plugins section for the exact format). */
export function parsePlugin(source: string): ParsedPlugin {
  const lines = source.split(/\r\n|\n/)
  const fields: Record<string, string> = {}
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    const match = HEADER_LINE.exec(line)
    if (!match) break
    fields[match[1].toLowerCase()] = match[2].trim()
  }

  const name = fields.name
  if (!name) throw new Error('Plugin is missing a "-- name: ..." header line.')

  const rawKind = fields.kind?.toLowerCase()
  const kind = rawKind ? KIND_ALIASES[rawKind] : undefined
  if (!kind) {
    throw new Error(
      'Plugin is missing a valid "-- kind: decoder" or "-- kind: plotter-parser" header line.',
    )
  }

  const entryPoint = kind === 'decoder' ? 'decode' : 'parse'
  if (!new RegExp(`function\\s+${entryPoint}\\s*\\(`).test(source)) {
    throw new Error(
      `Plugin declares kind "${rawKind}" but defines no "${entryPoint}(line)" function.`,
    )
  }

  return {
    manifest: {
      name,
      version: fields.version ?? '',
      description: fields.description ?? '',
      kind,
    },
    code: source,
  }
}
