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
import {
  useConnectionProfilesStore,
  type ConnectionProfile,
} from '../state/connectionProfilesStore'
import {
  ChipIcon,
  GaugeIcon,
  GlobeIcon,
  MessageIcon,
  PlugIcon,
  RefreshIcon,
  RepeatIcon,
  UsbIcon,
} from './icons'
import { LibraryRow } from './LibraryRow'

function formatHexId(id: number | null): string | null {
  return id === null ? null : `0x${id.toString(16).padStart(4, '0').toUpperCase()}`
}

const TARGETS: { value: ConnectionKind; label: string }[] = [
  { value: 'serial', label: 'Serial' },
  { value: 'tcp-client', label: 'TCP Client' },
  { value: 'tcp-server', label: 'TCP Server' },
  { value: 'udp', label: 'UDP' },
  { value: 'mqtt', label: 'MQTT' },
]

export function ConnectPanel({ onConnected }: { onConnected: () => void }) {
  const [target, setTarget] = useState<ConnectionKind>('serial')
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [portName, setPortName] = useState('')
  const [baudRate, setBaudRate] = useState(115200)
  const [dataBits, setDataBits] = useState<DataBits>('eight')
  const [parity, setParity] = useState<Parity>('none')
  const [stopBits, setStopBits] = useState<StopBits>('one')
  const [flowControl, setFlowControl] = useState<FlowControl>('none')
  const [autoReconnect, setAutoReconnect] = useState(true)
  const [host, setHost] = useState('192.168.1.1')
  const [tcpPort, setTcpPort] = useState(23)
  const [udpLocalPort, setUdpLocalPort] = useState(5005)
  const [udpRemoteHost, setUdpRemoteHost] = useState('')
  const [udpRemotePort, setUdpRemotePort] = useState(5006)
  const [brokerHost, setBrokerHost] = useState('broker.hivemq.com')
  const [brokerPort, setBrokerPort] = useState(1883)
  const [clientId, setClientId] = useState(() => `edt-${Math.random().toString(36).slice(2, 8)}`)
  const [mqttUsername, setMqttUsername] = useState('')
  const [mqttPassword, setMqttPassword] = useState('')
  const [subscribeTopic, setSubscribeTopic] = useState('#')
  const [publishTopic, setPublishTopic] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const openTab = useTabsStore((s) => s.openTab)
  const profiles = useConnectionProfilesStore((s) => s.items)
  const saveProfile = useConnectionProfilesStore((s) => s.save)
  const deleteProfile = useConnectionProfilesStore((s) => s.remove)

  const applyProfile = (p: ConnectionProfile) => {
    setTarget(p.kind)
    if (p.kind === 'serial') {
      setPortName(p.portName ?? '')
      setBaudRate(p.baudRate ?? 115200)
      setDataBits(p.dataBits ?? 'eight')
      setParity(p.parity ?? 'none')
      setStopBits(p.stopBits ?? 'one')
      setFlowControl(p.flowControl ?? 'none')
      setAutoReconnect(p.autoReconnect ?? true)
    } else if (p.kind === 'tcp-client') {
      setHost(p.host ?? '')
      setTcpPort(p.port ?? 0)
    } else if (p.kind === 'tcp-server') {
      setTcpPort(p.port ?? 0)
    } else if (p.kind === 'udp') {
      setUdpLocalPort(p.localPort ?? 0)
      setUdpRemoteHost(p.remoteHost ?? '')
      setUdpRemotePort(p.remotePort ?? 0)
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
      onConnected()
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const canConnect =
    target === 'serial'
      ? Boolean(portName)
      : target === 'tcp-client'
        ? Boolean(host)
        : target === 'udp'
          ? udpLocalPort > 0
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
      </h2>

      <div className="seg">
        {TARGETS.map((t) => (
          <span
            key={t.value}
            className={target === t.value ? 'on' : ''}
            onClick={() => setTarget(t.value)}
          >
            {t.label}
          </span>
        ))}
      </div>

      <LibraryRow
        label="Profile"
        items={profiles}
        onLoad={applyProfile}
        onSave={(name) =>
          saveProfile(
            name,
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
                    : {
                        kind: 'mqtt',
                        brokerHost,
                        brokerPort,
                        clientId,
                        username: mqttUsername,
                        password: mqttPassword,
                        subscribeTopic,
                        publishTopic,
                      },
          )
        }
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
