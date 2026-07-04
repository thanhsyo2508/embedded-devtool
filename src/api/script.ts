import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export function runScript(id: string, streamId: string, code: string): Promise<void> {
  return invoke('run_script', { id, streamId, code })
}

export function stopScript(id: string): Promise<void> {
  return invoke('stop_script', { id })
}

export interface ScriptLogEvent {
  id: string
  message: string
}

export interface ScriptPlotEvent {
  id: string
  streamId: string
  channel: string
  value: number
}

export interface ScriptDoneEvent {
  id: string
}

export function onScriptLog(cb: (e: ScriptLogEvent) => void): Promise<UnlistenFn> {
  return listen<ScriptLogEvent>('script://log', (event) => cb(event.payload))
}

export function onScriptAlert(cb: (e: ScriptLogEvent) => void): Promise<UnlistenFn> {
  return listen<ScriptLogEvent>('script://alert', (event) => cb(event.payload))
}

export function onScriptError(cb: (e: ScriptLogEvent) => void): Promise<UnlistenFn> {
  return listen<ScriptLogEvent>('script://error', (event) => cb(event.payload))
}

export function onScriptPlot(cb: (e: ScriptPlotEvent) => void): Promise<UnlistenFn> {
  return listen<ScriptPlotEvent>('script://plot', (event) => cb(event.payload))
}

export function onScriptDone(cb: (e: ScriptDoneEvent) => void): Promise<UnlistenFn> {
  return listen<ScriptDoneEvent>('script://done', (event) => cb(event.payload))
}
