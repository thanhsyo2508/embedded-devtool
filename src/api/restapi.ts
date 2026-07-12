import { invoke } from '@tauri-apps/api/core'

export function restApiStart(port: number, token: string): Promise<void> {
  return invoke('rest_api_start', { port, token })
}

export function restApiStop(): Promise<void> {
  return invoke('rest_api_stop')
}

export function restApiIsRunning(): Promise<boolean> {
  return invoke('rest_api_is_running')
}
