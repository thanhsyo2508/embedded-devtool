import { useEffect, useState } from 'react'
import {
  listSerialPorts,
  type DataBits,
  type FlowControl,
  type Parity,
  type PortInfo,
  type StopBits,
} from '../api/serial'
import { useTabsStore, type ConnectionKind } from '../state/tabsStore'
import { mdnsScan, type MdnsService } from '../api/network'
import {
  useConnectionProfilesStore,
  type ConnectionProfile,
} from '../state/connectionProfilesStore'
import { useLastConnectionStore, type LastConnectionConfig } from '../state/lastConnectionStore'
import {
  ChipIcon,
  GaugeIcon,
  GlobeIcon,
  MessageIcon,
  PlugIcon,
  RefreshIcon,
  RepeatIcon,
  UsbIcon,
  XIcon,
} from './icons'
import { LibraryRow } from './LibraryRow'

function formatHexId(id: number | null): string | null {
  return id === null ? null : `0x${id.toString(16).padStart(4, '0').toUpperCase()}`
}

// TCP and WebSocket each have a client/server role; grouping by protocol
// family first (one row, never wraps even in the compact connect panel)
// and only revealing the Client/Server sub-toggle for those two families
// keeps the picker from growing to 7 same-level options — see the "role"
// state below.
type ProtocolFamily = 'serial' | 'tcp' | 'udp' | 'ws' | 'mqtt'
type ConnectionRole = 'client' | 'server'

const FAMILIES: { value: ProtocolFamily; label: string }[] = [
  { value: 'serial', label: 'Serial' },
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
  { value: 'ws', label: 'WebSocket' },
  { value: 'mqtt', label: 'MQTT' },
]

function familyOf(kind: ConnectionKind): ProtocolFamily {
  switch (kind) {
    case 'tcp-client':
    case 'tcp-server':
      return 'tcp'
    case 'ws-client':
    case 'ws-server':
      return 'ws'
    default:
      return kind
  }
}

function roleOf(kind: ConnectionKind): ConnectionRole {
  return kind === 'tcp-server' || kind === 'ws-server' ? 'server' : 'client'
}

function kindFor(family: ProtocolFamily, role: ConnectionRole): ConnectionKind {
  if (family === 'tcp') return role === 'server' ? 'tcp-server' : 'tcp-client'
  if (family === 'ws') return role === 'server' ? 'ws-server' : 'ws-client'
  return family
}

// Which mDNS service types are worth offering depends on what's being
// configured — a bare TCP client could be any generic device service, but
// WebSocket/MQTT only ever look for their own protocol. Keyed by `target`
// (not just family) so the list only ever shows what's actually relevant to
// what's on screen, rather than one fixed list shared by every protocol.
const MDNS_PRESETS_BY_TARGET: Partial<Record<ConnectionKind, { value: string; label: string }[]>> =
  {
    'tcp-client': [
      { value: '_http._tcp.local.', label: 'HTTP (_http._tcp)' },
      { value: '_arduino._tcp.local.', label: 'Arduino OTA (_arduino._tcp)' },
      { value: '_esphomelib._tcp.local.', label: 'ESPHome (_esphomelib._tcp)' },
    ],
    'ws-client': [
      { value: '_ws._tcp.local.', label: 'WebSocket (_ws._tcp)' },
      { value: '_esphomelib._tcp.local.', label: 'ESPHome (_esphomelib._tcp)' },
    ],
    mqtt: [{ value: '_mqtt._tcp.local.', label: 'MQTT (_mqtt._tcp)' }],
  }

const MDNS_SCAN_MS = 3000

export function ConnectPanel({
  onConnected,
  onCancel,
}: {
  onConnected: () => void
  onCancel?: () => void
}) {
  // Read once at construction — these only seed initial state, they don't
  // need to be reactive (nothing here changes while this panel is mounted).
  const [initialLast] = useState(() => useLastConnectionStore.getState())
  const lastFor = (kind: ConnectionKind) => initialLast.byKind[kind]

  const [family, setFamily] = useState<ProtocolFamily>(() =>
    familyOf(initialLast.lastKind ?? 'serial'),
  )
  const [role, setRole] = useState<ConnectionRole>(() => roleOf(initialLast.lastKind ?? 'serial'))
  const target = kindFor(family, role)
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [portName, setPortName] = useState(() => lastFor('serial')?.portName ?? '')
  const [baudRate, setBaudRate] = useState(() => lastFor('serial')?.baudRate ?? 115200)
  const [dataBits, setDataBits] = useState<DataBits>(() => lastFor('serial')?.dataBits ?? 'eight')
  const [parity, setParity] = useState<Parity>(() => lastFor('serial')?.parity ?? 'none')
  const [stopBits, setStopBits] = useState<StopBits>(() => lastFor('serial')?.stopBits ?? 'one')
  const [flowControl, setFlowControl] = useState<FlowControl>(
    () => lastFor('serial')?.flowControl ?? 'none',
  )
  const [autoReconnect, setAutoReconnect] = useState(() => lastFor('serial')?.autoReconnect ?? true)
  const [rs485AutoRts, setRs485AutoRts] = useState(() => lastFor('serial')?.rs485AutoRts ?? false)
  const [host, setHost] = useState(() => lastFor('tcp-client')?.host ?? '192.168.1.1')
  const [tcpPort, setTcpPort] = useState(
    () => lastFor('tcp-client')?.port ?? lastFor('tcp-server')?.port ?? 23,
  )
  const [udpLocalPort, setUdpLocalPort] = useState(() => lastFor('udp')?.localPort ?? 5005)
  const [udpRemoteHost, setUdpRemoteHost] = useState(() => lastFor('udp')?.remoteHost ?? '')
  const [udpRemotePort, setUdpRemotePort] = useState(() => lastFor('udp')?.remotePort ?? 5006)
  const [wsUrl, setWsUrl] = useState(() => lastFor('ws-client')?.wsUrl ?? 'ws://192.168.1.1:81/')
  const [wsServerPort, setWsServerPort] = useState(() => lastFor('ws-server')?.port ?? 8080)
  const [brokerHost, setBrokerHost] = useState(
    () => lastFor('mqtt')?.brokerHost ?? 'broker.hivemq.com',
  )
  const [brokerPort, setBrokerPort] = useState(() => lastFor('mqtt')?.brokerPort ?? 1883)
  const [clientId, setClientId] = useState(
    () => lastFor('mqtt')?.clientId ?? `edt-${Math.random().toString(36).slice(2, 8)}`,
  )
  const [mqttUsername, setMqttUsername] = useState(() => lastFor('mqtt')?.username ?? '')
  const [mqttPassword, setMqttPassword] = useState(() => lastFor('mqtt')?.password ?? '')
  const [subscribeTopic, setSubscribeTopic] = useState(() => lastFor('mqtt')?.subscribeTopic ?? '#')
  const [publishTopic, setPublishTopic] = useState(() => lastFor('mqtt')?.publishTopic ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [mdnsType, setMdnsType] = useState(
    () => (MDNS_PRESETS_BY_TARGET[target] ?? [])[0]?.value ?? '',
  )
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<MdnsService[] | null>(null)
  const openTab = useTabsStore((s) => s.openTab)
  const rememberLastConnection = useLastConnectionStore((s) => s.remember)
  const profiles = useConnectionProfilesStore((s) => s.items)
  const targetProfiles = profiles.filter((p) => p.kind === target)
  const saveProfile = useConnectionProfilesStore((s) => s.save)
  const deleteProfile = useConnectionProfilesStore((s) => s.remove)

  const applyProfile = (p: ConnectionProfile) => {
    setFamily(familyOf(p.kind))
    setRole(roleOf(p.kind))
    if (p.kind === 'serial') {
      setPortName(p.portName ?? '')
      setBaudRate(p.baudRate ?? 115200)
      setDataBits(p.dataBits ?? 'eight')
      setParity(p.parity ?? 'none')
      setStopBits(p.stopBits ?? 'one')
      setFlowControl(p.flowControl ?? 'none')
      setAutoReconnect(p.autoReconnect ?? true)
      setRs485AutoRts(p.rs485AutoRts ?? false)
    } else if (p.kind === 'tcp-client') {
      setHost(p.host ?? '')
      setTcpPort(p.port ?? 0)
    } else if (p.kind === 'tcp-server') {
      setTcpPort(p.port ?? 0)
    } else if (p.kind === 'udp') {
      setUdpLocalPort(p.localPort ?? 0)
      setUdpRemoteHost(p.remoteHost ?? '')
      setUdpRemotePort(p.remotePort ?? 0)
    } else if (p.kind === 'ws-client') {
      setWsUrl(p.wsUrl ?? '')
    } else if (p.kind === 'ws-server') {
      setWsServerPort(p.port ?? 0)
    } else {
      setBrokerHost(p.brokerHost ?? '')
      setBrokerPort(p.brokerPort ?? 1883)
      setClientId(p.clientId ?? '')
      setMqttUsername(p.username ?? '')
      setMqttPassword(p.password ?? '')
      setSubscribeTopic(p.subscribeTopic ?? '#')
      setPublishTopic(p.publishTopic ?? '')
    }
  }

  useEffect(() => {
    let cancelled = false
    listSerialPorts()
      .then((list) => {
        if (cancelled) return
        setPorts(list)
        setPortName((current) => current || list[0]?.portName || '')
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err))
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  // Shared by "Save profile" and the automatic last-used-config memory —
  // both just want a snapshot of the currently entered fields for `target`.
  const currentConfigData = (): LastConnectionConfig =>
    target === 'serial'
      ? {
          kind: 'serial',
          portName,
          baudRate,
          dataBits,
          parity,
          stopBits,
          flowControl,
          autoReconnect,
          rs485AutoRts,
        }
      : target === 'tcp-client'
        ? { kind: 'tcp-client', host, port: tcpPort }
        : target === 'tcp-server'
          ? { kind: 'tcp-server', port: tcpPort }
          : target === 'udp'
            ? {
                kind: 'udp',
                localPort: udpLocalPort,
                remoteHost: udpRemoteHost,
                remotePort: udpRemotePort,
              }
            : target === 'ws-client'
              ? { kind: 'ws-client', wsUrl }
              : target === 'ws-server'
                ? { kind: 'ws-server', port: wsServerPort }
                : {
                    kind: 'mqtt',
                    brokerHost,
                    brokerPort,
                    clientId,
                    username: mqttUsername,
                    password: mqttPassword,
                    subscribeTopic,
                    publishTopic,
                  }

  const handleConnect = async () => {
    setLoading(true)
    setError(null)
    try {
      if (target === 'serial') {
        await openTab({
          kind: 'serial',
          id: `${portName}-${Date.now()}`,
          portName,
          baudRate,
          dataBits,
          parity,
          stopBits,
          flowControl,
          autoReconnect,
          rs485AutoRts,
        })
      } else if (target === 'tcp-client') {
        await openTab({
          kind: 'tcp-client',
          id: `${host}:${tcpPort}-${Date.now()}`,
          host,
          port: tcpPort,
        })
      } else if (target === 'tcp-server') {
        await openTab({ kind: 'tcp-server', id: `:${tcpPort}-${Date.now()}`, port: tcpPort })
      } else if (target === 'udp') {
        await openTab({
          kind: 'udp',
          id: `udp:${udpLocalPort}-${Date.now()}`,
          localPort: udpLocalPort,
          remoteHost: udpRemoteHost || undefined,
          remotePort: udpRemoteHost ? udpRemotePort : undefined,
        })
      } else if (target === 'ws-client') {
        await openTab({ kind: 'ws-client', id: `${wsUrl}-${Date.now()}`, url: wsUrl })
      } else if (target === 'ws-server') {
        await openTab({
          kind: 'ws-server',
          id: `ws::${wsServerPort}-${Date.now()}`,
          port: wsServerPort,
        })
      } else {
        await openTab({
          kind: 'mqtt',
          id: `mqtt:${brokerHost}:${brokerPort}-${Date.now()}`,
          brokerHost,
          brokerPort,
          clientId,
          username: mqttUsername || undefined,
          password: mqttPassword || undefined,
          subscribeTopic,
          publishTopic,
        })
      }
      rememberLastConnection(target, currentConfigData())
      onConnected()
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  // LAN discovery only makes sense where there's a remote host to fill in.
  const discoverVisible = target === 'tcp-client' || target === 'ws-client' || family === 'mqtt'
  const mdnsPresets = MDNS_PRESETS_BY_TARGET[target] ?? []

  // Re-target the preset list (and drop stale results from a previous
  // protocol) whenever what's being configured changes — adjusted during
  // render rather than in an effect, per React's guidance for resetting
  // state when a derived value changes (avoids an extra render pass).
  const [presetsFor, setPresetsFor] = useState(target)
  if (target !== presetsFor) {
    setPresetsFor(target)
    setMdnsType(mdnsPresets[0]?.value ?? '')
    setScanResults(null)
  }

  const handleScan = async () => {
    setScanning(true)
    setScanResults(null)
    try {
      setScanResults(await mdnsScan(mdnsType, MDNS_SCAN_MS))
    } catch (err) {
      setError(String(err))
    } finally {
      setScanning(false)
    }
  }

  const applyDiscovered = (svc: MdnsService) => {
    const addr = svc.addresses[0] ?? svc.hostname
    if (target === 'tcp-client') {
      setHost(addr)
      setTcpPort(svc.port)
    } else if (target === 'ws-client') {
      setWsUrl(`ws://${addr}:${svc.port}/`)
    } else if (family === 'mqtt') {
      setBrokerHost(addr)
      setBrokerPort(svc.port)
    }
  }

  const canConnect =
    target === 'serial'
      ? Boolean(portName)
      : target === 'tcp-client'
        ? Boolean(host)
        : target === 'udp'
          ? udpLocalPort > 0
          : target === 'ws-client'
            ? Boolean(wsUrl)
            : target === 'mqtt'
              ? Boolean(brokerHost) && Boolean(clientId)
              : true

  const selected = ports.find((p) => p.portName === portName) ?? null
  const hasDetails = Boolean(
    selected && (selected.product || selected.manufacturer || selected.vid !== null),
  )

  return (
    <div className="connect-panel">
      <h2>
        <PlugIcon /> New connection
        {onCancel && (
          <button
            type="button"
            className="icon-button connect-cancel"
            aria-label="Cancel"
            title="Back to current tab (Esc)"
            onClick={onCancel}
          >
            <XIcon />
          </button>
        )}
      </h2>

      <div className="seg">
        {FAMILIES.map((f) => (
          <span
            key={f.value}
            className={family === f.value ? 'on' : ''}
            onClick={() => setFamily(f.value)}
          >
            {f.label}
          </span>
        ))}
      </div>

      {(family === 'tcp' || family === 'ws') && (
        <div className="seg seg-role">
          <span className={role === 'client' ? 'on' : ''} onClick={() => setRole('client')}>
            Client
          </span>
          <span className={role === 'server' ? 'on' : ''} onClick={() => setRole('server')}>
            Server
          </span>
        </div>
      )}

      <LibraryRow
        label="Profile"
        items={targetProfiles}
        onLoad={applyProfile}
        onSave={(name) => saveProfile(name, currentConfigData())}
        onDelete={deleteProfile}
      />

      {target === 'serial' && (
        <>
          <label className="field-group">
            <span className="field-caption">
              <UsbIcon /> Port
            </span>
            <div className="field-row">
              <select value={portName} onChange={(e) => setPortName(e.target.value)}>
                {ports.length === 0 && <option value="">No ports found</option>}
                {ports.map((p) => (
                  <option key={p.portName} value={p.portName}>
                    {p.portName}
                    {p.product ? ` — ${p.product}` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-button"
                aria-label="Refresh ports"
                title="Refresh ports"
                onClick={() => setRefreshKey((k) => k + 1)}
              >
                <RefreshIcon />
              </button>
            </div>
          </label>

          {selected && hasDetails && (
            <div className="port-details">
              <ChipIcon className="port-details-icon" />
              <div className="port-details-text">
                <span className="port-details-name">{selected.product ?? selected.portName}</span>
                {selected.manufacturer && <span>{selected.manufacturer}</span>}
                {selected.vid !== null && (
                  <span className="mono">
                    {formatHexId(selected.vid)}:{formatHexId(selected.pid)}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="field-grid">
            <label className="field-group">
              <span className="field-caption">
                <GaugeIcon /> Baud
              </span>
              <input
                type="number"
                value={baudRate}
                onChange={(e) => setBaudRate(Number(e.target.value))}
              />
            </label>
            <label className="field-group">
              <span className="field-caption">Data bits</span>
              <select value={dataBits} onChange={(e) => setDataBits(e.target.value as DataBits)}>
                <option value="five">5</option>
                <option value="six">6</option>
                <option value="seven">7</option>
                <option value="eight">8</option>
              </select>
            </label>
            <label className="field-group">
              <span className="field-caption">Parity</span>
              <select value={parity} onChange={(e) => setParity(e.target.value as Parity)}>
                <option value="none">None</option>
                <option value="odd">Odd</option>
                <option value="even">Even</option>
              </select>
            </label>
            <label className="field-group">
              <span className="field-caption">Stop bits</span>
              <select value={stopBits} onChange={(e) => setStopBits(e.target.value as StopBits)}>
                <option value="one">1</option>
                <option value="two">2</option>
              </select>
            </label>
          </div>

          <label className="field-group">
            <span className="field-caption">Flow control</span>
            <select
              value={flowControl}
              onChange={(e) => setFlowControl(e.target.value as FlowControl)}
            >
              <option value="none">None</option>
              <option value="hardware">Hardware (RTS/CTS)</option>
              <option value="software">Software (XON/XOFF)</option>
            </select>
          </label>

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={autoReconnect}
              onChange={(e) => setAutoReconnect(e.target.checked)}
            />
            <RepeatIcon />
            <span>Auto-reconnect</span>
          </label>

          <label
            className="checkbox-field"
            title="Toggles RTS around each write for RS485 transceivers whose DE/RE pin has no auto-direction circuitry"
          >
            <input
              type="checkbox"
              checked={rs485AutoRts}
              onChange={(e) => setRs485AutoRts(e.target.checked)}
            />
            <RepeatIcon />
            <span>RS485 half-duplex (auto RTS toggle)</span>
          </label>
        </>
      )}

      {target === 'tcp-client' && (
        <div className="field-grid">
          <label className="field-group">
            <span className="field-caption">
              <GlobeIcon /> Host
            </span>
            <input
              type="text"
              value={host}
              placeholder="192.168.1.1"
              onChange={(e) => setHost(e.target.value)}
            />
          </label>
          <label className="field-group">
            <span className="field-caption">Port</span>
            <input
              type="number"
              value={tcpPort}
              onChange={(e) => setTcpPort(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      {target === 'tcp-server' && (
        <label className="field-group">
          <span className="field-caption">
            <GlobeIcon /> Listen on port
          </span>
          <input
            type="number"
            value={tcpPort}
            onChange={(e) => setTcpPort(Number(e.target.value))}
          />
        </label>
      )}

      {target === 'udp' && (
        <>
          <label className="field-group">
            <span className="field-caption">
              <GlobeIcon /> Local port (receive)
            </span>
            <input
              type="number"
              value={udpLocalPort}
              onChange={(e) => setUdpLocalPort(Number(e.target.value))}
            />
          </label>
          <div className="field-grid">
            <label className="field-group">
              <span className="field-caption">Remote host (to send, optional)</span>
              <input
                type="text"
                value={udpRemoteHost}
                placeholder="192.168.1.255 for broadcast"
                onChange={(e) => setUdpRemoteHost(e.target.value)}
              />
            </label>
            <label className="field-group">
              <span className="field-caption">Remote port</span>
              <input
                type="number"
                value={udpRemotePort}
                disabled={!udpRemoteHost}
                onChange={(e) => setUdpRemotePort(Number(e.target.value))}
              />
            </label>
          </div>
        </>
      )}

      {target === 'ws-client' && (
        <label className="field-group">
          <span className="field-caption">
            <GlobeIcon /> URL
          </span>
          <input
            type="text"
            value={wsUrl}
            placeholder="ws://192.168.1.1:81/"
            onChange={(e) => setWsUrl(e.target.value)}
          />
        </label>
      )}

      {target === 'ws-server' && (
        <label className="field-group">
          <span className="field-caption">
            <GlobeIcon /> Listen on port
          </span>
          <input
            type="number"
            value={wsServerPort}
            onChange={(e) => setWsServerPort(Number(e.target.value))}
          />
        </label>
      )}

      {target === 'mqtt' && (
        <>
          <div className="field-grid">
            <label className="field-group">
              <span className="field-caption">
                <GlobeIcon /> Broker host
              </span>
              <input
                type="text"
                value={brokerHost}
                placeholder="broker.hivemq.com"
                onChange={(e) => setBrokerHost(e.target.value)}
              />
            </label>
            <label className="field-group">
              <span className="field-caption">Port</span>
              <input
                type="number"
                value={brokerPort}
                onChange={(e) => setBrokerPort(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="field-group">
            <span className="field-caption">Client ID</span>
            <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          </label>
          <div className="field-grid">
            <label className="field-group">
              <span className="field-caption">Username (optional)</span>
              <input
                type="text"
                value={mqttUsername}
                onChange={(e) => setMqttUsername(e.target.value)}
              />
            </label>
            <label className="field-group">
              <span className="field-caption">Password (optional)</span>
              <input
                type="password"
                value={mqttPassword}
                onChange={(e) => setMqttPassword(e.target.value)}
              />
            </label>
          </div>
          <div className="field-grid">
            <label className="field-group">
              <span className="field-caption">
                <MessageIcon /> Subscribe topic
              </span>
              <input
                type="text"
                value={subscribeTopic}
                placeholder="#"
                onChange={(e) => setSubscribeTopic(e.target.value)}
              />
            </label>
            <label className="field-group">
              <span className="field-caption">Publish topic</span>
              <input
                type="text"
                value={publishTopic}
                placeholder="devices/my-device/cmd"
                onChange={(e) => setPublishTopic(e.target.value)}
              />
            </label>
          </div>
        </>
      )}

      {discoverVisible && (
        <div className="mdns-discover">
          <div className="field-row">
            <select value={mdnsType} onChange={(e) => setMdnsType(e.target.value)}>
              {mdnsPresets.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <button type="button" disabled={scanning} onClick={() => void handleScan()}>
              {scanning ? 'Scanning…' : 'Scan LAN'}
            </button>
          </div>
          {scanResults !== null &&
            (scanResults.length === 0 ? (
              <p className="mdns-empty">No devices found.</p>
            ) : (
              <div className="mdns-results">
                {scanResults.map((svc) => (
                  <button
                    key={svc.fullname}
                    type="button"
                    className="mdns-result"
                    title="Use this device's address"
                    onClick={() => applyDiscovered(svc)}
                  >
                    <span className="mdns-name">{svc.fullname.split('.')[0]}</span>
                    <span className="mono">
                      {svc.addresses[0] ?? svc.hostname}:{svc.port}
                    </span>
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}

      {error && <p className="connect-error">{error}</p>}

      <button
        type="button"
        className="connect-button"
        disabled={!canConnect || loading}
        onClick={() => void handleConnect()}
      >
        <PlugIcon />
        {loading ? 'Connecting…' : 'Connect'}
      </button>
    </div>
  )
}
