import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type StmInterface = { kind: 'swLink' } | { kind: 'uart'; port: string; baud: number }

export interface StmMcuInfo {
  deviceId: string | null
  deviceName: string | null
  rawOutput: string
}

export interface Stm32OutputEvent {
  id: string
  line: string
}

export type Stm32Operation = 'flash' | 'eraseFull' | 'writeOptionByte' | 'writeMemory'

export interface Stm32DoneEvent {
  id: string
  operation: Stm32Operation
  success: boolean
  message: string
}

export function findStm32Cli(): Promise<string | null> {
  return invoke('find_stm32_cli')
}

export function detectStm32Mcu(cliPath: string, iface: StmInterface): Promise<StmMcuInfo> {
  return invoke('detect_stm32_mcu', { cliPath, interface: iface })
}

export function flashStm32(req: {
  id: string
  cliPath: string
  interface: StmInterface
  filePath: string
  address: string
  verify: boolean
  reset: boolean
}): Promise<void> {
  return invoke('flash_stm32', { req })
}

export function massEraseStm32(id: string, cliPath: string, iface: StmInterface): Promise<void> {
  return invoke('mass_erase_stm32', { id, cliPath, interface: iface })
}

/** Reads the base address embedded in a `.hex` file's own records (a
 * `.bin` has no such information -- it's a raw memory dump). */
export function parseStm32HexAddress(path: string): Promise<string | null> {
  return invoke('parse_stm32_hex_address', { path })
}

export function writeStm32Memory(req: {
  id: string
  cliPath: string
  interface: StmInterface
  address: string
  data: number[]
  verify: boolean
  reset: boolean
}): Promise<void> {
  return invoke('write_stm32_memory', { req })
}

export function readStm32OptionBytes(cliPath: string, iface: StmInterface): Promise<string> {
  return invoke('read_stm32_option_bytes', { cliPath, interface: iface })
}

export function writeStm32OptionByte(
  id: string,
  cliPath: string,
  iface: StmInterface,
  name: string,
  value: string,
): Promise<void> {
  return invoke('write_stm32_option_byte', { id, cliPath, interface: iface, name, value })
}

export function onStm32Output(cb: (event: Stm32OutputEvent) => void): Promise<UnlistenFn> {
  return listen<Stm32OutputEvent>('stm32://output', (event) => cb(event.payload))
}

export function onStm32Done(cb: (event: Stm32DoneEvent) => void): Promise<UnlistenFn> {
  return listen<Stm32DoneEvent>('stm32://done', (event) => cb(event.payload))
}
