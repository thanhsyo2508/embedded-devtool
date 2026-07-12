import { useEffect, useRef, useState } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'
import { listSerialPorts, onUsbPlugged, onUsbUnplugged, type PortInfo } from '../api/serial'
import { bundledBootApp0Path, parseEsp32PartitionTable, type PartitionEntry } from '../api/flash'
import { useFlashStore, type FlashSegmentRow } from '../state/flashStore'
import { detectSegments } from '../lib/esp32SegmentDetect'
import {
  ChipIcon,
  FolderIcon,
  GearIcon,
  MagicWandIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
  ZapIcon,
} from './icons'
import { Stm32Body } from './Stm32Body'
import { FlashBatchPanel } from './FlashBatchPanel'
import { ProvisionPanel } from './ProvisionPanel'
import { OtaPanel } from './OtaPanel'
import { DebugPanel } from './DebugPanel'
import { ProductionStatsPanel } from './ProductionStatsPanel'
import { Esp32SecurityPanel } from './Esp32SecurityPanel'
import { Spinner } from './Spinner'
import { useDebugHandoffStore } from '../state/debugHandoffStore'
import { authorizeFlash } from '../lib/flashLock'

type Target = 'esp32' | 'stm32' | 'ota' | 'debug' | 'stats'
type FlashMode = 'single' | 'batch' | 'provision' | 'security'

const BAUD_OPTIONS = [115_200, 230_400, 460_800, 921_600]

function formatBytes(n: number): string {
  if (n === 0) return 'unknown'
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`
  return `${(n / 1024).toFixed(0)} KB`
}

export function FlashPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [target, setTarget] = useState<Target>(() =>
    useDebugHandoffStore.getState().pendingBacktraceText !== null ? 'debug' : 'esp32',
  )
  const [mode, setMode] = useState<FlashMode>('single')
  const [ports, setPorts] = useState<PortInfo[]>([])
  const portSelectRef = useRef<HTMLSelectElement>(null)
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
    setSegments,
    flash,
    eraseFull,
    saveProfile,
    loadProfile,
  } = useFlashStore()
  const [smartAdding, setSmartAdding] = useState(false)

  useEffect(() => {
    const refresh = () => {
      // Skip while the port <select> is open/focused — swapping its options
      // out from under an in-progress click risks flashing the wrong port.
      if (document.activeElement === portSelectRef.current) return
      listSerialPorts()
        .then(setPorts)
        .catch(() => {})
    }
    refresh()
    const unlistenPlugged = onUsbPlugged(refresh)
    const unlistenUnplugged = onUsbUnplugged(refresh)
    return () => {
      void unlistenPlugged.then((f) => f())
      void unlistenUnplugged.then((f) => f())
    }
  }, [])

  const browseForFile = async (index: number) => {
    const picked = await open({
      title: t('flash.selectFirmwareTitle'),
      filters: [{ name: t('flash.firmwareFilterName'), extensions: ['bin'] }],
    })
    if (typeof picked === 'string') {
      updateSegment(index, { path: picked })
    }
  }

  const handleSaveProfile = async () => {
    const path = await save({
      title: t('flash.saveProfileTitle'),
      filters: [{ name: t('flash.profileFilterName'), extensions: ['json'] }],
    })
    if (path) void saveProfile(path)
  }

  const handleLoadProfile = async () => {
    const path = await open({
      title: t('flash.loadProfileTitle'),
      filters: [{ name: t('flash.profileFilterName'), extensions: ['json'] }],
    })
    if (typeof path === 'string') void loadProfile(path)
  }

  const handleEraseFull = () => {
    if (window.confirm(t('flash.eraseConfirm'))) {
      void eraseFull()
    }
  }

  // "Smart add": pick the build output files at once (bootloader,
  // partitions.bin, firmware.bin, a filesystem image...) and let
  // detectSegments() figure out where each one goes — reading the real
  // partition table when one was selected rather than guessing an offset
  // that varies with flash size/partition scheme (see esp32SegmentDetect.ts).
  const handleSmartAdd = async () => {
    const picked = await open({
      title: t('flash.smartAddDialogTitle'),
      multiple: true,
      filters: [{ name: t('flash.firmwareFilterName'), extensions: ['bin'] }],
    })
    const filePaths = Array.isArray(picked) ? picked : picked ? [picked] : []
    if (filePaths.length === 0) return

    setSmartAdding(true)
    try {
      const partitionFile = filePaths.find((p) => /partition/i.test(p) && /\.bin$/i.test(p))
      let partitions: PartitionEntry[] | null = null
      if (partitionFile) {
        try {
          partitions = await parseEsp32PartitionTable(partitionFile)
        } catch (err) {
          window.alert(t('flash.partitionParseError', { error: String(err) }))
        }
      }

      const needsBootApp0 =
        (partitions?.some((e) => e.partType === 0x01 && e.subtype === 0x00) ?? false) &&
        !filePaths.some((p) => /boot_?app0/i.test(p))
      const bootApp0Path = needsBootApp0 ? await bundledBootApp0Path().catch(() => null) : null

      const chipFamily = chipInfo ? (chipInfo.chip === 'ESP32' ? 'esp32' : 'other') : null
      const detected = detectSegments({ filePaths, partitions, chipFamily, bootApp0Path })

      const rows: FlashSegmentRow[] = detected.map((seg) => ({
        offset: seg.offset === null ? '' : `0x${seg.offset.toString(16)}`,
        path: seg.path,
        label: seg.label,
      }))
      setSegments(rows)

      const unmatchedCount = detected.filter((s) => s.source === 'unmatched').length
      if (unmatchedCount > 0) {
        window.alert(t('flash.unmatchedWarning', { count: unmatchedCount }))
      }
    } finally {
      setSmartAdding(false)
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
            <ZapIcon /> {t('flash.title')}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('common.close')}
            onClick={onClose}
          >
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
          <span className={target === 'ota' ? 'on' : ''} onClick={() => setTarget('ota')}>
            {t('ota.tabLabel')}
          </span>
          <span className={target === 'debug' ? 'on' : ''} onClick={() => setTarget('debug')}>
            {t('debug.tabLabel')}
          </span>
          <span className={target === 'stats' ? 'on' : ''} onClick={() => setTarget('stats')}>
            {t('productionStats.tabLabel')}
          </span>
        </div>
        {target === 'stm32' && <Stm32Body />}
        {target === 'ota' && <OtaPanel />}
        {target === 'debug' && <DebugPanel />}
        {target === 'stats' && <ProductionStatsPanel />}

        {target === 'esp32' && (
          <>
            <div className="seg">
              <span className={mode === 'single' ? 'on' : ''} onClick={() => setMode('single')}>
                {t('flash.single')}
              </span>
              <span className={mode === 'batch' ? 'on' : ''} onClick={() => setMode('batch')}>
                {t('flash.batch')}
              </span>
              <span
                className={mode === 'provision' ? 'on' : ''}
                onClick={() => setMode('provision')}
              >
                {t('flash.provision')}
              </span>
              <span className={mode === 'security' ? 'on' : ''} onClick={() => setMode('security')}>
                {t('esp32Security.tabLabel')}
              </span>
            </div>

            {mode === 'single' && (
              <>
                <div className="flash-connect-row">
                  <select
                    ref={portSelectRef}
                    value={portName}
                    onChange={(e) => setPortName(e.target.value)}
                  >
                    <option value="">{t('flash.selectPort')}</option>
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
                    {detecting ? t('flash.detecting') : t('flash.detectChip')}
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
                      <span>
                        {t('flash.flashSize', { size: formatBytes(chipInfo.flashSizeBytes) })}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}

            {mode !== 'provision' && (
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
                      placeholder={t('flash.noFileSelected')}
                      readOnly
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t('common.browse')}
                      title={t('common.browse')}
                      onClick={() => void browseForFile(i)}
                    >
                      <FolderIcon />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={t('flash.removeSegment')}
                      title={t('common.remove')}
                      onClick={() => removeSegment(i)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))}
                <div className="flash-segments-actions">
                  <button type="button" className="flash-add-segment" onClick={addSegment}>
                    <PlusIcon /> {t('flash.addSegment')}
                  </button>
                  <button
                    type="button"
                    className="flash-add-segment"
                    disabled={smartAdding}
                    onClick={() => void handleSmartAdd()}
                    title={t('flash.smartAddTitle')}
                  >
                    <MagicWandIcon /> {smartAdding ? t('flash.detecting') : t('flash.smartAdd')}
                  </button>
                </div>
              </div>
            )}

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
                    {t('flash.saveProfile')}
                  </button>
                  <button type="button" onClick={() => void handleLoadProfile()}>
                    {t('flash.loadProfile')}
                  </button>
                  <button
                    type="button"
                    className="flash-erase"
                    disabled={!portName || busy}
                    onClick={handleEraseFull}
                  >
                    <GearIcon /> {t('flash.eraseChip')}
                  </button>
                  <button
                    type="button"
                    className="connect-button flash-go"
                    disabled={!portName || busy}
                    onClick={() => {
                      if (authorizeFlash()) void flash()
                    }}
                  >
                    {busy ? <Spinner /> : <ZapIcon />}{' '}
                    {busy ? t('flash.working') : t('flash.flash')}
                  </button>
                </div>

                <div className="flash-log">
                  {log.length === 0 && (
                    <div className="flash-log-empty">{t('flash.noActivity')}</div>
                  )}
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

            {mode === 'provision' && <ProvisionPanel ports={ports} />}
            {mode === 'security' && <Esp32SecurityPanel port={portName} />}
          </>
        )}
      </div>
    </div>
  )
}
