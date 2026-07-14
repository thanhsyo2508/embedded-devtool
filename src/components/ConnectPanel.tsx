import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  listSerialPorts,
  onUsbPlugged,
  onUsbUnplugged,
  type DataBits,
  type FlowControl,
  type Parity,
  type PortInfo,
  type StopBits,
} from '../api/serial'
import { useTabsStore, type ConnectionKind } from '../state/tabsStore'
import {
  listSwdProbes,
  mdnsScan,
  searchSwdChips,
  type MdnsService,
  type SwdProbeInfo,
} from '../api/network'
import {
  useConnectionProfilesStore,
  type ConnectionProfile,
} from '../state/connectionProfilesStore'
import { useLastConnectionStore, type LastConnectionConfig } from '../state/lastConnectionStore'
import { useRecentConnectionsStore } from '../state/recentConnectionsStore'
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
import { Spinner } from './Spinner'

function formatHexId(id: number | null): string | null {
  return id === null ? null : `0x${id.toString(16).padStart(4, '0').toUpperCase()}`
}

// TCP and WebSocket each have a client/server role; grouping by protocol
// family first (one row, never wraps even in the compact connect panel)
// and only revealing the Client/Server sub-toggle for those two families
// keeps the picker from growing to 7 same-level options — see the "role"
// state below.
type ProtocolFamily = 'serial' | 'tcp' | 'udp' | 'ws' | 'mqtt' | 'ssh' | 'rtt'
type ConnectionRole = 'client' | 'server'

const FAMILIES: ProtocolFamily[] = ['serial', 'tcp', 'udp', 'ws', 'mqtt', 'ssh', 'rtt']

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
    ssh: [{ value: '_ssh._tcp.local.', label: 'SSH (_ssh._tcp)' }],
  }

const MDNS_SCAN_MS = 3000

export function ConnectPanel({
  onConnected,
  onCancel,
}: {
  onConnected: (tabId: string) => void
  onCancel?: () => void
}) {
  const { t } = useTranslation()
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
  const portSelectRef = useRef<HTMLSelectElement>(null)
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
  // Password intentionally never seeded from lastFor/profiles — see
  // currentConfigData below, it's never included in what gets persisted.
  const [sshHost, setSshHost] = useState(() => lastFor('ssh')?.host ?? '192.168.1.1')
  const [sshPort, setSshPort] = useState(() => lastFor('ssh')?.port ?? 22)
  const [sshUsername, setSshUsername] = useState(() => lastFor('ssh')?.username ?? '')
  const [sshPassword, setSshPassword] = useState('')
  const [probeSerial, setProbeSerial] = useState(() => lastFor('rtt')?.probeSerial ?? '')
  const [chip, setChip] = useState(() => lastFor('rtt')?.chip ?? '')
  const [probes, setProbes] = useState<SwdProbeInfo[]>([])
  const [chipSuggestions, setChipSuggestions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [mdnsType, setMdnsType] = useState(
    () => (MDNS_PRESETS_BY_TARGET[target] ?? [])[0]?.value ?? '',
  )
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<MdnsService[] | null>(null)
  const [hintDismissed, setHintDismissed] = useState(false)
  const openTab = useTabsStore((s) => s.openTab)
  const rememberLastConnection = useLastConnectionStore((s) => s.remember)
  const recentConnectionsCount = useRecentConnectionsStore((s) => s.items.length)
  const pushRecentConnection = useRecentConnectionsStore((s) => s.push)
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
    } else if (p.kind === 'ssh') {
      setSshHost(p.host ?? '')
      setSshPort(p.port ?? 22)
      setSshUsername(p.username ?? '')
      // Password is deliberately never saved in a profile — re-enter it.
      setSshPassword('')
    } else if (p.kind === 'rtt') {
      setProbeSerial(p.probeSerial ?? '')
      setChip(p.chip ?? '')
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
        // `current` starts out seeded from the last-remembered serial config
        // (see the portName useState above), which can name a port that no
        // longer exists (unplugged, or just a stale value from a previous
        // session) — the browser then shows a *different* option as visually
        // selected (its default fallback when the bound value matches
        // nothing) while React still holds the stale name, so Connect would
        // silently submit a port the user never actually picked. Falling
        // back whenever `current` isn't in the live list keeps the visible
        // selection and the submitted value in sync.
        setPortName((current) =>
          current && list.some((p) => p.portName === current) ? current : (list[0]?.portName ?? ''),
        )
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err))
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  // Re-list ports on USB plug/unplug so the dropdown stays current without
  // the user having to click the refresh button (serialport-rs has no
  // native hotplug API — this rides the 1.5s poll+diff done in Rust). Skips
  // the refresh while the port <select> is open/focused: swapping its
  // options out from under an in-progress click can silently commit a
  // different port than the one the user actually clicked on.
  useEffect(() => {
    const refreshIfIdle = () => {
      if (document.activeElement === portSelectRef.current) return
      setRefreshKey((k) => k + 1)
    }
    const unlistenPlugged = onUsbPlugged(refreshIfIdle)
    const unlistenUnplugged = onUsbUnplugged(refreshIfIdle)
    return () => {
      void unlistenPlugged.then((f) => f())
      void unlistenUnplugged.then((f) => f())
    }
  }, [])

  // Probes are USB devices, so they could in principle be plugged/unplugged
  // like serial ports — but unlike serial there's no hotplug event for them,
  // so this just re-lists once whenever the SWD family is selected rather
  // than polling continuously.
  useEffect(() => {
    if (family !== 'rtt') return
    listSwdProbes()
      .then(setProbes)
      .catch(() => {})
  }, [family])

  // Clears stale suggestions the moment family/chip stop warranting them —
  // adjusted during render rather than in an effect, per React's guidance
  // for resetting state derived from a changed value (same pattern as the
  // presetsFor guard above).
  const [suggestionsFor, setSuggestionsFor] = useState({ family, chip })
  if (suggestionsFor.family !== family || suggestionsFor.chip !== chip) {
    setSuggestionsFor({ family, chip })
    if (family !== 'rtt' || !chip.trim()) setChipSuggestions([])
  }

  // Debounced chip-name autocomplete against probe-rs's built-in chip
  // database — a plain <datalist>, so no dropdown UI of its own to manage.
  useEffect(() => {
    if (family !== 'rtt' || !chip.trim()) return
    const timeout = setTimeout(() => {
      searchSwdChips(chip)
        .then(setChipSuggestions)
        .catch(() => {})
    }, 200)
    return () => clearTimeout(timeout)
  }, [family, chip])

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
                : target === 'ssh'
                  ? // Password never included here — this snapshot feeds both
                    // "Save profile" and the last-used-config memory, both of
                    // which persist to localStorage.
                    { kind: 'ssh', host: sshHost, port: sshPort, username: sshUsername }
                  : target === 'rtt'
                    ? { kind: 'rtt', probeSerial: probeSerial || undefined, chip }
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
      let tabId: string
      if (target === 'serial') {
        tabId = `${portName}-${Date.now()}`
        await openTab({
          kind: 'serial',
          id: tabId,
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
        tabId = `${host}:${tcpPort}-${Date.now()}`
        await openTab({
          kind: 'tcp-client',
          id: tabId,
          host,
          port: tcpPort,
        })
      } else if (target === 'tcp-server') {
        tabId = `:${tcpPort}-${Date.now()}`
        await openTab({ kind: 'tcp-server', id: tabId, port: tcpPort })
      } else if (target === 'udp') {
        tabId = `udp:${udpLocalPort}-${Date.now()}`
        await openTab({
          kind: 'udp',
          id: tabId,
          localPort: udpLocalPort,
          remoteHost: udpRemoteHost || undefined,
          remotePort: udpRemoteHost ? udpRemotePort : undefined,
        })
      } else if (target === 'ws-client') {
        tabId = `${wsUrl}-${Date.now()}`
        await openTab({ kind: 'ws-client', id: tabId, url: wsUrl })
      } else if (target === 'ws-server') {
        tabId = `ws::${wsServerPort}-${Date.now()}`
        await openTab({
          kind: 'ws-server',
          id: tabId,
          port: wsServerPort,
        })
      } else if (target === 'mqtt') {
        tabId = `mqtt:${brokerHost}:${brokerPort}-${Date.now()}`
        await openTab({
          kind: 'mqtt',
          id: tabId,
          brokerHost,
          brokerPort,
          clientId,
          username: mqttUsername || undefined,
          password: mqttPassword || undefined,
          subscribeTopic,
          publishTopic,
        })
      } else if (target === 'ssh') {
        tabId = `ssh:${sshUsername}@${sshHost}:${sshPort}-${Date.now()}`
        await openTab({
          kind: 'ssh',
          id: tabId,
          host: sshHost,
          port: sshPort,
          username: sshUsername,
          password: sshPassword,
        })
      } else {
        tabId = `rtt:${chip}-${Date.now()}`
        await openTab({
          kind: 'rtt',
          id: tabId,
          probeSerial: probeSerial || undefined,
          chip,
        })
      }
      const configSnapshot = currentConfigData()
      rememberLastConnection(target, configSnapshot)
      const openedTab = useTabsStore.getState().tabs.find((t) => t.id === tabId)
      if (openedTab) pushRecentConnection(target, configSnapshot, openedTab.connectionLabel)
      onConnected(tabId)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  // LAN discovery only makes sense where there's a remote host to fill in.
  const discoverVisible =
    target === 'tcp-client' || target === 'ws-client' || family === 'mqtt' || family === 'ssh'
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
    } else if (family === 'ssh') {
      setSshHost(addr)
      setSshPort(svc.port)
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
              : target === 'ssh'
                ? Boolean(sshHost) && Boolean(sshUsername) && Boolean(sshPassword)
                : target === 'rtt'
                  ? Boolean(chip)
                  : true

  const selected = ports.find((p) => p.portName === portName) ?? null
  const hasDetails = Boolean(
    selected && (selected.product || selected.manufacturer || selected.vid !== null),
  )

  return (
    <div className="connect-overlay" onClick={onCancel}>
      <div className="connect-panel" onClick={(e) => e.stopPropagation()}>
        <h2>
          <PlugIcon /> {t('connect.title')}
          {onCancel && (
            <button
              type="button"
              className="icon-button connect-cancel"
              aria-label={t('common.cancel')}
              title={t('connect.cancelTitle')}
              onClick={onCancel}
            >
              <XIcon />
            </button>
          )}
        </h2>

        {!hintDismissed && recentConnectionsCount === 0 && profiles.length === 0 && (
          <div className="onboarding-hint">
            <span>{t('connect.onboardingHint')}</span>
            <button
              type="button"
              className="icon-button"
              aria-label={t('common.dismiss')}
              title={t('common.dismiss')}
              onClick={() => setHintDismissed(true)}
            >
              <XIcon />
            </button>
          </div>
        )}

        <div className="seg">
          {FAMILIES.map((f) => (
            <span key={f} className={family === f ? 'on' : ''} onClick={() => setFamily(f)}>
              {t(`connect.family.${f}`)}
            </span>
          ))}
        </div>

        {(family === 'tcp' || family === 'ws') && (
          <div className="seg seg-role">
            <span className={role === 'client' ? 'on' : ''} onClick={() => setRole('client')}>
              {t('connect.role.client')}
            </span>
            <span className={role === 'server' ? 'on' : ''} onClick={() => setRole('server')}>
              {t('connect.role.server')}
            </span>
          </div>
        )}

        <LibraryRow
          label={t('connect.profileLabel')}
          items={targetProfiles}
          onLoad={applyProfile}
          onSave={(name) => saveProfile(name, currentConfigData())}
          onDelete={deleteProfile}
        />

        {target === 'serial' && (
          <>
            <label className="field-group">
              <span className="field-caption">
                <UsbIcon /> {t('connect.port')}
              </span>
              <div className="field-row">
                <select
                  ref={portSelectRef}
                  value={portName}
                  onChange={(e) => setPortName(e.target.value)}
                >
                  {ports.length === 0 && <option value="">{t('connect.noPortsFound')}</option>}
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
                  aria-label={t('connect.refreshPorts')}
                  title={t('connect.refreshPorts')}
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
                  <GaugeIcon /> {t('connect.baud')}
                </span>
                <input
                  type="number"
                  value={baudRate}
                  onChange={(e) => setBaudRate(Number(e.target.value))}
                />
              </label>
              <label className="field-group">
                <span className="field-caption">{t('connect.dataBits')}</span>
                <select value={dataBits} onChange={(e) => setDataBits(e.target.value as DataBits)}>
                  <option value="five">5</option>
                  <option value="six">6</option>
                  <option value="seven">7</option>
                  <option value="eight">8</option>
                </select>
              </label>
              <label className="field-group">
                <span className="field-caption">{t('connect.parity')}</span>
                <select value={parity} onChange={(e) => setParity(e.target.value as Parity)}>
                  <option value="none">{t('connect.parityNone')}</option>
                  <option value="odd">{t('connect.parityOdd')}</option>
                  <option value="even">{t('connect.parityEven')}</option>
                </select>
              </label>
              <label className="field-group">
                <span className="field-caption">{t('connect.stopBits')}</span>
                <select value={stopBits} onChange={(e) => setStopBits(e.target.value as StopBits)}>
                  <option value="one">1</option>
                  <option value="two">2</option>
                </select>
              </label>
            </div>

            <label className="field-group">
              <span className="field-caption">{t('connect.flowControl')}</span>
              <select
                value={flowControl}
                onChange={(e) => setFlowControl(e.target.value as FlowControl)}
              >
                <option value="none">{t('connect.flowNone')}</option>
                <option value="hardware">{t('connect.flowHardware')}</option>
                <option value="software">{t('connect.flowSoftware')}</option>
              </select>
            </label>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={autoReconnect}
                onChange={(e) => setAutoReconnect(e.target.checked)}
              />
              <RepeatIcon />
              <span>{t('connect.autoReconnect')}</span>
            </label>

            <label className="checkbox-field" title={t('connect.rs485Title')}>
              <input
                type="checkbox"
                checked={rs485AutoRts}
                onChange={(e) => setRs485AutoRts(e.target.checked)}
              />
              <RepeatIcon />
              <span>{t('connect.rs485Label')}</span>
            </label>
          </>
        )}

        {target === 'tcp-client' && (
          <div className="field-grid">
            <label className="field-group">
              <span className="field-caption">
                <GlobeIcon /> {t('connect.host')}
              </span>
              <input
                type="text"
                value={host}
                placeholder="192.168.1.1"
                onChange={(e) => setHost(e.target.value)}
              />
            </label>
            <label className="field-group">
              <span className="field-caption">{t('connect.port')}</span>
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
              <GlobeIcon /> {t('connect.listenOnPort')}
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
                <GlobeIcon /> {t('connect.localPortReceive')}
              </span>
              <input
                type="number"
                value={udpLocalPort}
                onChange={(e) => setUdpLocalPort(Number(e.target.value))}
              />
            </label>
            <div className="field-grid">
              <label className="field-group">
                <span className="field-caption">{t('connect.remoteHostOptional')}</span>
                <input
                  type="text"
                  value={udpRemoteHost}
                  placeholder={t('connect.remoteHostPlaceholder')}
                  onChange={(e) => setUdpRemoteHost(e.target.value)}
                />
              </label>
              <label className="field-group">
                <span className="field-caption">{t('connect.remotePort')}</span>
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
              <GlobeIcon /> {t('connect.url')}
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
              <GlobeIcon /> {t('connect.listenOnPort')}
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
                  <GlobeIcon /> {t('connect.brokerHost')}
                </span>
                <input
                  type="text"
                  value={brokerHost}
                  placeholder="broker.hivemq.com"
                  onChange={(e) => setBrokerHost(e.target.value)}
                />
              </label>
              <label className="field-group">
                <span className="field-caption">{t('connect.port')}</span>
                <input
                  type="number"
                  value={brokerPort}
                  onChange={(e) => setBrokerPort(Number(e.target.value))}
                />
              </label>
            </div>
            <label className="field-group">
              <span className="field-caption">{t('connect.clientId')}</span>
              <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} />
            </label>
            <div className="field-grid">
              <label className="field-group">
                <span className="field-caption">{t('connect.usernameOptional')}</span>
                <input
                  type="text"
                  value={mqttUsername}
                  onChange={(e) => setMqttUsername(e.target.value)}
                />
              </label>
              <label className="field-group">
                <span className="field-caption">{t('connect.passwordOptional')}</span>
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
                  <MessageIcon /> {t('connect.subscribeTopic')}
                </span>
                <input
                  type="text"
                  value={subscribeTopic}
                  placeholder="#"
                  onChange={(e) => setSubscribeTopic(e.target.value)}
                />
              </label>
              <label className="field-group">
                <span className="field-caption">{t('connect.publishTopic')}</span>
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

        {target === 'ssh' && (
          <>
            <div className="field-grid">
              <label className="field-group">
                <span className="field-caption">
                  <GlobeIcon /> {t('connect.host')}
                </span>
                <input
                  type="text"
                  value={sshHost}
                  placeholder="192.168.1.1"
                  onChange={(e) => setSshHost(e.target.value)}
                />
              </label>
              <label className="field-group">
                <span className="field-caption">{t('connect.port')}</span>
                <input
                  type="number"
                  value={sshPort}
                  onChange={(e) => setSshPort(Number(e.target.value))}
                />
              </label>
            </div>
            <div className="field-grid">
              <label className="field-group">
                <span className="field-caption">{t('connect.username')}</span>
                <input
                  type="text"
                  value={sshUsername}
                  onChange={(e) => setSshUsername(e.target.value)}
                />
              </label>
              <label className="field-group">
                <span className="field-caption">{t('connect.password')}</span>
                <input
                  type="password"
                  value={sshPassword}
                  onChange={(e) => setSshPassword(e.target.value)}
                />
              </label>
            </div>
          </>
        )}

        {target === 'rtt' && (
          <>
            <label className="field-group">
              <span className="field-caption">
                <UsbIcon /> {t('connect.probe')}
              </span>
              <div className="field-row">
                <select value={probeSerial} onChange={(e) => setProbeSerial(e.target.value)}>
                  <option value="">{t('connect.probeAuto')}</option>
                  {probes.map((p) => (
                    <option key={p.serialNumber ?? p.identifier} value={p.serialNumber ?? ''}>
                      {p.identifier}
                      {p.serialNumber ? ` (${p.serialNumber})` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('connect.refreshProbes')}
                  title={t('connect.refreshProbes')}
                  onClick={() => void listSwdProbes().then(setProbes)}
                >
                  <RefreshIcon />
                </button>
              </div>
              {probes.length === 0 && <p className="mdns-empty">{t('connect.noProbesFound')}</p>}
            </label>
            <label className="field-group">
              <span className="field-caption">
                <ChipIcon /> {t('connect.chip')}
              </span>
              <input
                type="text"
                list="swd-chip-suggestions"
                value={chip}
                placeholder="STM32F407VG"
                onChange={(e) => setChip(e.target.value)}
              />
              <datalist id="swd-chip-suggestions">
                {chipSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </label>
            <p className="ota-hint">{t('connect.rttHint')}</p>
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
                {scanning ? t('connect.scanning') : t('connect.scanLan')}
              </button>
            </div>
            {scanResults !== null &&
              (scanResults.length === 0 ? (
                <p className="mdns-empty">{t('connect.noDevicesFound')}</p>
              ) : (
                <div className="mdns-results">
                  {scanResults.map((svc) => (
                    <button
                      key={svc.fullname}
                      type="button"
                      className="mdns-result"
                      title={t('connect.useThisDeviceAddress')}
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
          {loading ? <Spinner /> : <PlugIcon />}
          {loading ? t('connect.connecting') : t('connect.connect')}
        </button>
      </div>
    </div>
  )
}
