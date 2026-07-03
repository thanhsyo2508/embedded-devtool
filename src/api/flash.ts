import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface ChipInfo {
  chip: string
  revision: string | null
  flashSizeBytes: number
  macAddress: string | null
  features: string[]
}

export interface FlashSegmentReq {
  offset: number
  path: string
}

export type FlashProgress =
  | { phase: 'writing'; addr: number; current: number; total: number }
  | { phase: 'verifying' }
  | { phase: 'segmentDone' }

export interface FlashProgressEvent {
  id: string
  phase: FlashProgress['phase']
  addr?: number
  current?: number
  total?: number
}

export type FlashOperation = 'flash' | 'eraseFull' | 'eraseRegion' | 'readFlash'

export interface FlashDoneEvent {
  id: string
  operation: FlashOperation
  success: boolean
  message: string
}

export interface FlashProfileSegment {
  offset: number
  path: string
  label?: string | null
}

export interface FlashProfile {
  name: string
  chip?: string | null
  baudRate: number
  segments: FlashProfileSegment[]
}

export function detectEsp32Chip(portName: string): Promise<ChipInfo> {
  return invoke('detect_esp32_chip', { portName })
}

export function flashEsp32(
  id: string,
  portName: string,
  baud: number,
  segments: FlashSegmentReq[],
): Promise<void> {
  return invoke('flash_esp32', { id, portName, baud, segments })
}

export function eraseEsp32Flash(id: string, portName: string): Promise<void> {
  return invoke('erase_esp32_flash', { id, portName })
}

export function eraseEsp32Region(
  id: string,
  portName: string,
  offset: number,
  size: number,
): Promise<void> {
  return invoke('erase_esp32_region', { id, portName, offset, size })
}

export function readEsp32Flash(
  id: string,
  portName: string,
  offset: number,
  size: number,
  outPath: string,
): Promise<void> {
  return invoke('read_esp32_flash', { id, portName, offset, size, outPath })
}

export function saveFlashProfile(path: string, profile: FlashProfile): Promise<void> {
  return invoke('save_flash_profile', { path, profile })
}

export function loadFlashProfile(path: string): Promise<FlashProfile> {
  return invoke('load_flash_profile', { path })
}

export function onFlashProgress(cb: (event: FlashProgressEvent) => void): Promise<UnlistenFn> {
  return listen<FlashProgressEvent>('flash://progress', (event) => cb(event.payload))
}

export function onFlashDone(cb: (event: FlashDoneEvent) => void): Promise<UnlistenFn> {
  return listen<FlashDoneEvent>('flash://done', (event) => cb(event.payload))
}
