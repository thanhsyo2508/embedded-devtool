import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { onUsbPlugged, type PortInfo } from '../api/serial'
import type { FlashSegmentReq } from '../api/flash'
import { useFlashBatchStore, type BatchDevice } from '../state/flashBatchStore'
import { useTabsStore } from '../state/tabsStore'
import { isLikelyEsp32Vid } from '../lib/esp32VidPid'
import { authorizeFlash } from '../lib/flashLock'
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
  const { t } = useTranslation()
  const devices = useFlashBatchStore((s) => s.devices)
  const wireEventsOnce = useFlashBatchStore((s) => s.wireEventsOnce)
  const setSelectedPorts = useFlashBatchStore((s) => s.setSelectedPorts)
  const flashAll = useFlashBatchStore((s) => s.flashAll)
  const autoFlashArmed = useFlashBatchStore((s) => s.autoFlashArmed)
  const setAutoFlashArmed = useFlashBatchStore((s) => s.setAutoFlashArmed)
  const autoFlashDevice = useFlashBatchStore((s) => s.autoFlashDevice)

  useEffect(() => {
    wireEventsOnce()
  }, [wireEventsOnce])

  // Auto-flash on plug: only while armed, and only for a port that isn't
  // already open in a monitor/other tab (flashing steals the port
  // exclusively — see esp32.rs's module doc — so racing an open tab would
  // just fail with an OS "port busy" error instead of doing anything unsafe,
  // but skipping it up front gives a clearer message).
  useEffect(() => {
    if (!autoFlashArmed) return
    const unlisten = onUsbPlugged((event) => {
      if (!isLikelyEsp32Vid(event.vid)) return
      if (segments.length === 0) return
      const portOpenElsewhere = useTabsStore
        .getState()
        .tabs.some((t) => t.portName === event.portName && t.status === 'open')
      if (portOpenElsewhere) return
      autoFlashDevice(event.portName, baudRate, segments)
    })
    return () => {
      void unlisten.then((f) => f())
    }
  }, [autoFlashArmed, baudRate, segments, autoFlashDevice])

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
    if (device.status === 'done') return t('flashBatch.statusDone')
    if (device.status === 'error') return t('flashBatch.statusError', { message: device.message })
    return t('flashBatch.statusQueued')
  }

  return (
    <div className="flash-batch">
      <label className="flash-batch-autoflash">
        <input
          type="checkbox"
          checked={autoFlashArmed}
          onChange={(e) => {
            const next = e.target.checked
            if (next && !authorizeFlash()) return
            setAutoFlashArmed(next)
          }}
        />
        {t('flashBatch.autoFlashLabel')}
      </label>
      {autoFlashArmed && segments.length === 0 && (
        <div className="flash-batch-autoflash-warn">{t('flashBatch.autoFlashNoSegments')}</div>
      )}
      <div className="flash-batch-ports">
        {ports.length === 0 && (
          <div className="flash-log-empty">{t('flashBatch.noPortsDetected')}</div>
        )}
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
        onClick={() => {
          if (authorizeFlash()) flashAll(baudRate, segments)
        }}
      >
        <ZapIcon />{' '}
        {busy ? t('flashBatch.flashing') : t('flashBatch.flashNDevices', { count: devices.length })}
      </button>
    </div>
  )
}
