import { useEffect, useState } from 'react'
import {
  listSerialPorts,
  type DataBits,
  type FlowControl,
  type Parity,
  type PortInfo,
  type StopBits,
} from '../api/serial'
import { useTabsStore } from '../state/tabsStore'
import { ChipIcon, GaugeIcon, PlugIcon, RefreshIcon, RepeatIcon, UsbIcon } from './icons'

function formatHexId(id: number | null): string | null {
  return id === null ? null : `0x${id.toString(16).padStart(4, '0').toUpperCase()}`
}

export function ConnectPanel({ onConnected }: { onConnected: () => void }) {
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [portName, setPortName] = useState('')
  const [baudRate, setBaudRate] = useState(115200)
  const [dataBits, setDataBits] = useState<DataBits>('eight')
  const [parity, setParity] = useState<Parity>('none')
  const [stopBits, setStopBits] = useState<StopBits>('one')
  const [flowControl, setFlowControl] = useState<FlowControl>('none')
  const [autoReconnect, setAutoReconnect] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const openTab = useTabsStore((s) => s.openTab)

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
    if (!portName) return
    setLoading(true)
    setError(null)
    try {
      await openTab({
        id: `${portName}-${Date.now()}`,
        portName,
        baudRate,
        dataBits,
        parity,
        stopBits,
        flowControl,
        autoReconnect,
      })
      onConnected()
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const selected = ports.find((p) => p.portName === portName) ?? null
  const hasDetails = Boolean(
    selected && (selected.product || selected.manufacturer || selected.vid !== null),
  )

  return (
    <div className="connect-panel">
      <h2>
        <PlugIcon /> New connection
      </h2>

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
        <select value={flowControl} onChange={(e) => setFlowControl(e.target.value as FlowControl)}>
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

      {error && <p className="connect-error">{error}</p>}

      <button
        type="button"
        className="connect-button"
        disabled={!portName || loading}
        onClick={() => void handleConnect()}
      >
        <PlugIcon />
        {loading ? 'Connecting…' : 'Connect'}
      </button>
    </div>
  )
}
