import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LastConnectionConfig } from './lastConnectionStore'
import type { ConnectionKind, OpenTabRequest } from './tabsStore'

export interface RecentConnection {
  id: string
  kind: ConnectionKind
  label: string
  config: LastConnectionConfig
  connectedAtMs: number
}

interface RecentConnectionsState {
  items: RecentConnection[]
  push: (kind: ConnectionKind, config: LastConnectionConfig, label: string) => void
  remove: (id: string) => void
}

const MAX_RECENT = 8

/** Auto-tracked history of the last few connections actually made, across
 * every protocol — unlike lastConnectionStore (one slot per kind, used to
 * seed the form's defaults) or connectionProfilesStore (named, manually
 * saved), this is what backs ConnectPanel's "Recent" quick-reconnect list:
 * unnamed, ordered by recency, capped. */
export const useRecentConnectionsStore = create<RecentConnectionsState>()(
  persist(
    (set) => ({
      items: [],
      push: (kind, config, label) =>
        set((state) => {
          const withoutDupe = state.items.filter(
            (item) => !(item.kind === kind && item.label === label),
          )
          const entry: RecentConnection = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            kind,
            config,
            label,
            connectedAtMs: Date.now(),
          }
          return { items: [entry, ...withoutDupe].slice(0, MAX_RECENT) }
        }),
      remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
    }),
    { name: 'edt-recent-connections' },
  ),
)

/** Turns a recent entry straight into an `openTab` request — lets the
 * command palette reconnect in one action instead of opening ConnectPanel
 * and clicking through it. SSH never persists a password (see
 * ConnectPanel's currentConfigData), so callers must prompt for one and
 * pass it through; every other kind reconnects with no extra input. */
export function recentConnectionToOpenRequest(
  recent: RecentConnection,
  id: string,
  sshPassword?: string,
): OpenTabRequest {
  const c = recent.config
  switch (recent.kind) {
    case 'serial':
      return {
        kind: 'serial',
        id,
        portName: c.portName ?? '',
        baudRate: c.baudRate ?? 115200,
        dataBits: c.dataBits ?? 'eight',
        parity: c.parity ?? 'none',
        stopBits: c.stopBits ?? 'one',
        flowControl: c.flowControl ?? 'none',
        autoReconnect: c.autoReconnect ?? true,
        rs485AutoRts: c.rs485AutoRts ?? false,
      }
    case 'tcp-client':
      return { kind: 'tcp-client', id, host: c.host ?? '', port: c.port ?? 0 }
    case 'tcp-server':
      return { kind: 'tcp-server', id, port: c.port ?? 0 }
    case 'udp':
      return {
        kind: 'udp',
        id,
        localPort: c.localPort ?? 0,
        remoteHost: c.remoteHost,
        remotePort: c.remotePort,
      }
    case 'ws-client':
      return { kind: 'ws-client', id, url: c.wsUrl ?? '' }
    case 'ws-server':
      return { kind: 'ws-server', id, port: c.port ?? 0 }
    case 'mqtt':
      return {
        kind: 'mqtt',
        id,
        brokerHost: c.brokerHost ?? '',
        brokerPort: c.brokerPort ?? 1883,
        clientId: c.clientId ?? '',
        username: c.username,
        password: c.password,
        subscribeTopic: c.subscribeTopic ?? '#',
        publishTopic: c.publishTopic ?? '',
      }
    case 'ssh':
      return {
        kind: 'ssh',
        id,
        host: c.host ?? '',
        port: c.port ?? 22,
        username: c.username ?? '',
        password: sshPassword ?? '',
      }
  }
}
