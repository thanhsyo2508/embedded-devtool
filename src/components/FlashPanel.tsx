import { useEffect, useState } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { listSerialPorts, type PortInfo } from '../api/serial'
import { useFlashStore } from '../state/flashStore'
import { ChipIcon, FolderIcon, GearIcon, PlusIcon, TrashIcon, XIcon, ZapIcon } from './icons'
import { Stm32Body } from './Stm32Body'
import { FlashBatchPanel } from './FlashBatchPanel'

type Target = 'esp32' | 'stm32'
type FlashMode = 'single' | 'batch'

const BAUD_OPTIONS = [115_200, 230_400, 460_800, 921_600]

function formatBytes(n: number): string {
  if (n === 0) return 'unknown'
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`
  return `${(n / 1024).toFixed(0)} KB`
}

export function FlashPanel({ onClose }: { onClose: () => void }) {
  const [target, setTarget] = useState<Target>('esp32')
  const [mode, setMode] = useState<FlashMode>('single')
  const [ports, setPorts] = useState<PortInfo[]>([])
  const {
    portName,
    baudRate,
    chipInfo,
    detecting,
    segments,
    busy,
    progressCurrent,
    progressTotal,
    log,
    setPortName,
    setBaudRate,
    detectChip,
    addSegment,
    removeSegment,
    updateSegment,
    flash,
    eraseFull,
    saveProfile,
    loadProfile,
  } = useFlashStore()

  useEffect(() => {
    listSerialPorts()
      .then(setPorts)
      .catch(() => {})
  }, [])

  const browseForFile = async (index: number) => {
    const picked = await open({
      title: 'Select firmware .bin',
      filters: [{ name: 'Firmware', extensions: ['bin'] }],
    })
    if (typeof picked === 'string') {
      updateSegment(index, { path: picked })
    }
  }

  const handleSaveProfile = async () => {
    const path = await save({
      title: 'Save flash profile',
      filters: [{ name: 'Flash profile', extensions: ['json'] }],
    })
    if (path) void saveProfile(path)
  }

  const handleLoadProfile = async () => {
    const path = await open({
      title: 'Load flash profile',
      filters: [{ name: 'Flash profile', extensions: ['json'] }],
    })
    if (typeof path === 'string') void loadProfile(path)
  }

  const handleEraseFull = () => {
    if (window.confirm('Erase the entire chip? This cannot be undone.')) {
      void eraseFull()
    }
  }

  const progressPct = progressTotal > 0 ? Math.round((progressCurrent / progressTotal) * 100) : 0
  const parsedSegments = segments
    .filter((s) => s.path)
    .map((s) => ({ offset: Number(s.offset), path: s.path }))

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="flash-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">
            <ZapIcon /> Flash
          </span>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <XIcon />
          </button>
        </div>

        <div className="seg">
          <span className={target === 'esp32' ? 'on' : ''} onClick={() => setTarget('esp32')}>
            ESP32
          </span>
          <span className={target === 'stm32' ? 'on' : ''} onClick={() => setTarget('stm32')}>
            STM32
          </span>
        </div>
        {target === 'stm32' && <Stm32Body />}

        {target === 'esp32' && (
          <>
            <div className="seg">
              <span className={mode === 'single' ? 'on' : ''} onClick={() => setMode('single')}>
                Single
              </span>
              <span className={mode === 'batch' ? 'on' : ''} onClick={() => setMode('batch')}>
                Batch
              </span>
            </div>

            {mode === 'single' && (
              <>
                <div className="flash-connect-row">
                  <select value={portName} onChange={(e) => setPortName(e.target.value)}>
                    <option value="">Select port…</option>
                    {ports.map((p) => (
                      <option key={p.portName} value={p.portName}>
                        {p.portName}
                        {p.product ? ` — ${p.product}` : ''}
                      </option>
                    ))}
                  </select>
                  <select value={baudRate} onChange={(e) => setBaudRate(Number(e.target.value))}>
                    {BAUD_OPTIONS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!portName || detecting}
                    onClick={() => void detectChip()}
                  >
                    {detecting ? 'Detecting…' : 'Detect chip'}
                  </button>
                </div>

                {chipInfo && (
                  <div className="port-details">
                    <ChipIcon className="port-details-icon" />
                    <div className="port-details-text">
                      <span className="port-details-name">{chipInfo.chip}</span>
                      {chipInfo.macAddress && (
                        <span className="mono">MAC {chipInfo.macAddress}</span>
                      )}
                      <span>flash {formatBytes(chipInfo.flashSizeBytes)}</span>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="flash-segments">
              {segments.map((seg, i) => (
                <div className="flash-segment-row" key={i}>
                  <input
                    className="flash-offset"
                    value={seg.offset}
                    placeholder="0x0"
                    onChange={(e) => updateSegment(i, { offset: e.target.value })}
                  />
                  <input
                    className="flash-path"
                    value={seg.path}
                    placeholder="No file selected"
                    readOnly
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Browse"
                    title="Browse"
                    onClick={() => void browseForFile(i)}
                  >
                    <FolderIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Remove segment"
                    title="Remove"
                    onClick={() => removeSegment(i)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
              <button type="button" className="flash-add-segment" onClick={addSegment}>
                <PlusIcon /> Add segment
              </button>
            </div>

            {mode === 'single' && (
              <>
                {busy && progressTotal > 0 && (
                  <div className="flash-progress">
                    <div className="flash-progress-bar">
                      <div className="flash-progress-fill" style={{ width: `${progressPct}%` }} />
                    </div>
                    <span className="mono">{progressPct}%</span>
                  </div>
                )}

                <div className="flash-actions">
                  <button type="button" onClick={() => void handleSaveProfile()}>
                    Save profile
                  </button>
                  <button type="button" onClick={() => void handleLoadProfile()}>
                    Load profile
                  </button>
                  <button
                    type="button"
                    className="flash-erase"
                    disabled={!portName || busy}
                    onClick={handleEraseFull}
                  >
                    <GearIcon /> Erase chip
                  </button>
                  <button
                    type="button"
                    className="connect-button flash-go"
                    disabled={!portName || busy}
                    onClick={() => void flash()}
                  >
                    <ZapIcon /> {busy ? 'Working…' : 'Flash'}
                  </button>
                </div>

                <div className="flash-log">
                  {log.length === 0 && <div className="flash-log-empty">No activity yet.</div>}
                  {log.map((line, i) => (
                    <div key={i} className="flash-log-line">
                      {line}
                    </div>
                  ))}
                </div>
              </>
            )}

            {mode === 'batch' && (
              <FlashBatchPanel ports={ports} baudRate={baudRate} segments={parsedSegments} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
