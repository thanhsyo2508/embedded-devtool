import { createLibraryStore, type LibraryItem } from './createLibraryStore'
import type { DataBits, FlowControl, Parity, StopBits } from '../api/serial'

export interface ConnectionProfile extends LibraryItem {
  portName: string
  baudRate: number
  dataBits: DataBits
  parity: Parity
  stopBits: StopBits
  flowControl: FlowControl
  autoReconnect: boolean
}

export const useConnectionProfilesStore =
  createLibraryStore<ConnectionProfile>('edt-connection-profiles')
