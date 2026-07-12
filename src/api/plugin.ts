import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type PluginKind = 'decoder' | 'plotterParser'

export function pluginRun(
  id: string,
  streamId: string,
  kind: PluginKind,
  code: string,
): Promise<void> {
  return invoke('plugin_run', { id, streamId, kind, code })
}

export function pluginStop(id: string): Promise<void> {
  return invoke('plugin_stop', { id })
}

export interface PluginDecodedEvent {
  id: string
  fields: Record<string, string>
}

export interface PluginPlotEvent {
  id: string
  streamId: string
  channel: string
  value: number
}

export interface PluginErrorEvent {
  id: string
  message: string
}

export interface PluginDoneEvent {
  id: string
}

export function onPluginDecoded(cb: (e: PluginDecodedEvent) => void): Promise<UnlistenFn> {
  return listen<PluginDecodedEvent>('plugin://decoded', (event) => cb(event.payload))
}

export function onPluginPlot(cb: (e: PluginPlotEvent) => void): Promise<UnlistenFn> {
  return listen<PluginPlotEvent>('plugin://plot', (event) => cb(event.payload))
}

export function onPluginError(cb: (e: PluginErrorEvent) => void): Promise<UnlistenFn> {
  return listen<PluginErrorEvent>('plugin://error', (event) => cb(event.payload))
}

export function onPluginDone(cb: (e: PluginDoneEvent) => void): Promise<UnlistenFn> {
  return listen<PluginDoneEvent>('plugin://done', (event) => cb(event.payload))
}
