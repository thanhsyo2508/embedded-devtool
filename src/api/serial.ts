import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type DataBits = 'five' | 'six' | 'seven' | 'eight'
export type Parity = 'none' | 'odd' | 'even'
export type StopBits = 'one' | 'two'
export type FlowControl = 'none' | 'software' | 'hardware'

export interface PortInfo {
  portName: string
  vid: number | null
  pid: number | null
  serialNumber: string | null
  manufacturer: string | null
  product: string | null
}

export interface OpenPortRequest {
  id: string
  portName: string
  baudRate: number
  dataBits?: DataBits
  parity?: Parity
  stopBits?: StopBits
  flowControl?: FlowControl
  autoReconnect?: boolean
}

export type PortStatus = { status: 'open' } | { status: 'error'; message: string }

export type PortStateEntry = { id: string } & PortStatus

export interface SerialDataBatch {
  id: string
  data: number[]
}

export type PortLifecycleEvent =
  | { kind: 'opened'; streamId: string }
  | { kind: 'closed'; streamId: string }
  | { kind: 'error'; streamId: string; message: string }

export function listSerialPorts(): Promise<PortInfo[]> {
  return invoke('list_serial_ports')
}

export function openSerialPort(req: OpenPortRequest): Promise<void> {
  return invoke('open_serial_port', { req })
}

export function closeSerialPort(id: string): Promise<void> {
  return invoke('close_serial_port', { id })
}

export function writeSerialPort(id: string, data: number[]): Promise<void> {
  return invoke('write_serial_port', { id, data })
}

export function getSerialPortStates(): Promise<PortStateEntry[]> {
  return invoke('serial_port_states')
}

export function startSerialLogging(id: string): Promise<string> {
  return invoke('start_serial_logging', { id })
}

export function stopSerialLogging(id: string): Promise<void> {
  return invoke('stop_serial_logging', { id })
}

export interface SignalState {
  cts: boolean
  dsr: boolean
  ri: boolean
  cd: boolean
}

export function setSerialDtr(id: string, level: boolean): Promise<void> {
  return invoke('set_serial_dtr', { id, level })
}

export function setSerialRts(id: string, level: boolean): Promise<void> {
  return invoke('set_serial_rts', { id, level })
}

export function readSerialSignals(id: string): Promise<SignalState> {
  return invoke('read_serial_signals', { id })
}

export function onSerialData(cb: (batch: SerialDataBatch) => void): Promise<UnlistenFn> {
  return listen<SerialDataBatch>('serial://data', (event) => cb(event.payload))
}

export function onSerialLifecycle(cb: (event: PortLifecycleEvent) => void): Promise<UnlistenFn> {
  return listen<PortLifecycleEvent>('serial://lifecycle', (event) => cb(event.payload))
}
