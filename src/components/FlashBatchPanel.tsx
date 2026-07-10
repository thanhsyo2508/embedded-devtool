import { useEffect } from 'react'
import type { PortInfo } from '../api/serial'
import type { FlashSegmentReq } from '../api/flash'
import { useFlashBatchStore, type BatchDevice } from '../state/flashBatchStore'
import { ZapIcon } from './icons'

/** Same firmware (baudRate/segments), many ports at once — flashes every
 * checked port concurrently and tracks each one's progress independently.
 * Rendered inline in FlashPanel's ESP32 tab instead of the single-device
 * port/detect/progress UI when the Single/Batch sub-toggle is on Batch. */
export function FlashBatchPanel({
  ports,
  baudRate,
  segments,
}: {
  ports: PortInfo[]
  baudRate: number
  segments: FlashSegmentReq[]
}) {
  const devices = useFlashBatchStore((s) => s.devices)
  const wireEventsOnce = useFlashBatchStore((s) => s.wireEventsOnce)
  const setSelectedPorts = useFlashBatchStore((s) => s.setSelectedPorts)
  const flashAll = useFlashBatchStore((s) => s.flashAll)

  useEffect(() => {
    wireEventsOnce()
  }, [wireEventsOnce])

  const selectedPortNames = new Set(devices.map((d) => d.portName))
  const busy = devices.some((d) => d.status === 'flashing')

  const togglePort = (portName: string) => {
    if (busy) return
    const next = selectedPortNames.has(portName)
      ? devices.map((d) => d.portName).filter((p) => p !== portName)
      : [...devices.map((d) => d.portName), portName]
    setSelectedPorts(next)
  }

  const statusLabel = (device: BatchDevice | undefined) => {
    if (!device) return null
    if (device.status === 'flashing') {
      const pct =
        device.progressTotal > 0
          ? Math.round((device.progressCurrent / device.progressTotal) * 100)
          : 0
      return `${pct}%`
    }
    if (device.status === 'done') return '✓ Done'
    if (device.status === 'error') return `✗ ${device.message}`
    return 'Queued'
  }

  return (
    <div className="flash-batch">
      <div className="flash-batch-ports">
        {ports.length === 0 && <div className="flash-log-empty">No serial ports detected.</div>}
        {ports.map((p) => {
          const device = devices.find((d) => d.portName === p.portName)
          return (
            <label key={p.portName} className="flash-batch-row">
              <input
                type="checkbox"
                checked={selectedPortNames.has(p.portName)}
                disabled={busy}
                onChange={() => togglePort(p.portName)}
              />
              <span className="flash-batch-port">
                {p.portName}
                {p.product ? ` — ${p.product}` : ''}
              </span>
              {device && (
                <span className={`flash-batch-status status-${device.status}`}>
                  {statusLabel(device)}
                </span>
              )}
            </label>
          )
        })}
      </div>
      <button
        type="button"
        className="connect-button flash-go"
        disabled={devices.length === 0 || segments.length === 0 || busy}
        onClick={() => flashAll(baudRate, segments)}
      >
        <ZapIcon /> {busy ? 'Flashing…' : `Flash ${devices.length} device(s)`}
      </button>
    </div>
  )
}
