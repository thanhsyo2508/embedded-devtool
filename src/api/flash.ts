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

export interface PartitionEntry {
  label: string
  partType: number
  subtype: number
  offset: number
  size: number
}

export function detectEsp32Chip(portName: string): Promise<ChipInfo> {
  return invoke('detect_esp32_chip', { portName })
}

export function parseEsp32PartitionTable(path: string): Promise<PartitionEntry[]> {
  return invoke('parse_esp32_partition_table', { path })
}

export interface SectionInfo {
  name: string
  address: number
  size: number
  kind: 'text' | 'data' | 'rodata' | 'bss' | 'other'
}

export interface MemoryMap {
  sections: SectionInfo[]
  flashBytes: number
  ramBytes: number
}

/** Reads a build's `.elf` directly for a flash/RAM breakdown by section —
 * no separate `.map` file needed. */
export function parseElfMemoryMap(path: string): Promise<MemoryMap> {
  return invoke('parse_elf_memory_map', { path })
}

export interface DecodedFrame {
  address: number
  function: string | null
  file: string | null
  line: number | null
}

/** Extracts addresses from a pasted crash backtrace and resolves each to
 * a function/file/line via the `.elf`'s DWARF debug info. */
export function decodeEsp32Backtrace(elfPath: string, text: string): Promise<DecodedFrame[]> {
  return invoke('decode_esp32_backtrace', { elfPath, text })
}

/** Writes the bundled `boot_app0.bin` (see THIRD_PARTY_NOTICES.md) to a temp
 * file and returns its path — used by "Smart add" when an OTA-capable
 * partition table needs an `otadata` image the user's build output didn't
 * include. */
export function bundledBootApp0Path(): Promise<string> {
  return invoke('bundled_boot_app0_path')
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

// ---- ESP32 OTA-over-WiFi (espota protocol) ----

export type OtaProgress =
  | { phase: 'inviting' }
  | { phase: 'authenticating' }
  | { phase: 'waitingForDevice' }
  | { phase: 'writing'; current: number; total: number }

export interface OtaProgressEvent {
  id: string
  phase: OtaProgress['phase']
  current?: number
  total?: number
}

/** Flashes a device over WiFi via the ArduinoOTA protocol — no serial port
 * involved, so this doesn't touch PortManager at all. `password` is the
 * plaintext ArduinoOTA password (empty string if the device has none). */
export function otaFlashEsp32(
  id: string,
  host: string,
  port: number,
  password: string,
  firmwarePath: string,
): Promise<void> {
  return invoke('ota_flash_esp32', { id, host, port, password, firmwarePath })
}

export function onOtaProgress(cb: (event: OtaProgressEvent) => void): Promise<UnlistenFn> {
  return listen<OtaProgressEvent>('ota://progress', (event) => cb(event.payload))
}

export function onOtaDone(cb: (event: FlashDoneEvent) => void): Promise<UnlistenFn> {
  return listen<FlashDoneEvent>('ota://done', (event) => cb(event.payload))
}
