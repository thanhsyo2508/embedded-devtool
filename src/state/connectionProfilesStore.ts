import { createLibraryStore, type LibraryItem } from './createLibraryStore'
import type { DataBits, FlowControl, Parity, StopBits } from '../api/serial'
import type { ConnectionKind } from './tabsStore'

// Flat rather than a discriminated union: generic `createLibraryStore` uses
// a plain `Omit<T, 'id' | 'name'>` for its save() payload, which doesn't
// distribute over unions, so a serial/tcp-client/tcp-server union would
// lose the non-common fields. `kind` still says which fields apply.
export interface ConnectionProfile extends LibraryItem {
  kind: ConnectionKind
  portName?: string
  baudRate?: number
  dataBits?: DataBits
  parity?: Parity
  stopBits?: StopBits
  flowControl?: FlowControl
  autoReconnect?: boolean
  rs485AutoRts?: boolean
  host?: string
  port?: number
  localPort?: number
  remoteHost?: string
  remotePort?: number
  wsUrl?: string
  brokerHost?: string
  brokerPort?: number
  clientId?: string
  username?: string
  password?: string
  subscribeTopic?: string
  publishTopic?: string
}

export const useConnectionProfilesStore =
  createLibraryStore<ConnectionProfile>('edt-connection-profiles')
