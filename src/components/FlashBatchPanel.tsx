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

  // A card is driven by *either* source, never just `ports`: an ESP32-S2/S3/C3
  // with native USB commonly disconnects and re-enumerates while it resets
  // into the bootloader mid-flash, which drops it from `ports` for a moment
  // (or, on some hosts, for good). Flashing itself is unaffected — it holds
  // its own exclusive serial handle, independent of this list (see
  // esp32.rs) — but if the card only rendered `ports.map(...)`, that same
  // blip would make the card (and its progress bar) vanish while the flash
  // was still running fine underneath, so a real, in-progress or just-
  // finished flash could silently show no progress at all. Tracked devices
  // that fell off `ports` are kept as "ghost" cards (no checkbox, no
  // product name — nothing to select or re-derive) until they're cleared
  // by picking a fresh port selection.
  const rows: { port: PortInfo | null; device: BatchDevice | undefined }[] = [
    ...ports.map((port) => ({ port, device: devices.find((d) => d.portName === port.portName) })),
    ...devices
      .filter((d) => !ports.some((p) => p.portName === d.portName))
      .map((device) => ({ port: null, device })),
  ]

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
        {rows.length === 0 && (
          <div className="flash-log-empty">{t('flashBatch.noPortsDetected')}</div>
        )}
        {rows.map(({ port, device }) => {
          const portName = port?.portName ?? device?.portName
          if (!portName) return null
          const isSelected = port !== null && selectedPortNames.has(portName)
          // A visible fill even at rest (0%) keeps every card the same
          // height instead of the bar popping in only once flashing starts.
          const pct =
            device?.status === 'done' || device?.status === 'error'
              ? 100
              : device && device.progressTotal > 0
                ? Math.round((device.progressCurrent / device.progressTotal) * 100)
                : 0
          return (
            <div
              key={portName}
              className={`flash-batch-card ${isSelected ? 'selected' : ''} ${port ? '' : 'ghost'}`}
              onClick={() => {
                if (port && !busy) togglePort(portName)
              }}
            >
              <div className="flash-batch-card-head">
                {port && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={busy}
                    onChange={() => togglePort(portName)}
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
                <span className="flash-batch-card-name">{portName}</span>
                {device && (
                  <span className={`flash-batch-card-status status-${device.status}`}>
                    {statusLabel(device)}
                  </span>
                )}
              </div>
              <span className="flash-batch-card-product">{port?.product ?? ' '}</span>
              <div className="flash-batch-card-progress-bar">
                <div
                  className={`flash-batch-card-progress-fill status-${device?.status ?? 'idle'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {device?.status === 'error' && (
                <span className="flash-batch-card-message" title={device.message}>
                  {device.message}
                </span>
              )}
            </div>
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
