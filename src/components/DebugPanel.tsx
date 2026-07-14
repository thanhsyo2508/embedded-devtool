import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'
import {
  decodeEsp32Backtrace,
  openInEditor,
  parseElfMemoryMap,
  type DecodedFrame,
  type MemoryMap,
} from '../api/flash'
import { useDebugHandoffStore } from '../state/debugHandoffStore'
import { FolderIcon, SearchIcon } from './icons'
import { Spinner } from './Spinner'

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

function formatAddress(n: number): string {
  return `0x${n.toString(16).padStart(8, '0')}`
}

/** Reads a build's `.elf` directly (DWARF + section headers, via
 * addr2line/object on the Rust side) for two things esptool/
 * STM32CubeProgrammer don't offer: a flash/RAM breakdown by section, and
 * decoding a pasted crash backtrace's raw addresses into function/file/
 * line. Both share the same selected `.elf`, so one file picker feeds
 * both sections below. */
export function DebugPanel() {
  const { t } = useTranslation()
  const [elfPath, setElfPath] = useState('')
  const [memoryMap, setMemoryMap] = useState<MemoryMap | null>(null)
  const [mapBusy, setMapBusy] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const [backtraceText, setBacktraceText] = useState(
    () => useDebugHandoffStore.getState().pendingBacktraceText ?? '',
  )
  const [frames, setFrames] = useState<DecodedFrame[] | null>(null)
  const [decodeBusy, setDecodeBusy] = useState(false)
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const clearPendingBacktraceText = useDebugHandoffStore((s) => s.clearPendingBacktraceText)

  // One-shot consumption of the monitor's right-click handoff (see
  // debugHandoffStore) — clear it so reopening this panel later starts
  // fresh instead of reusing stale pasted text.
  useEffect(() => {
    clearPendingBacktraceText()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const browseForElf = async () => {
    const picked = await open({
      title: t('debug.selectElfTitle'),
      filters: [{ name: t('debug.elfFilterName'), extensions: ['elf', 'out'] }],
    })
    if (typeof picked === 'string') {
      setElfPath(picked)
      setMemoryMap(null)
      setFrames(null)
    }
  }

  const handleAnalyze = async () => {
    setMapBusy(true)
    setMapError(null)
    try {
      setMemoryMap(await parseElfMemoryMap(elfPath))
    } catch (err) {
      setMapError(String(err))
    } finally {
      setMapBusy(false)
    }
  }

  const handleOpenInEditor = (frame: DecodedFrame) => {
    if (!frame.file) return
    openInEditor(frame.file, frame.line ?? undefined).catch((err: unknown) => {
      setDecodeError(String(err))
    })
  }

  const handleDecode = async () => {
    setDecodeBusy(true)
    setDecodeError(null)
    try {
      setFrames(await decodeEsp32Backtrace(elfPath, backtraceText))
    } catch (err) {
      setDecodeError(String(err))
    } finally {
      setDecodeBusy(false)
    }
  }

  const maxSectionSize = memoryMap ? Math.max(...memoryMap.sections.map((s) => s.size), 1) : 1

  return (
    <div className="debug-panel">
      <p className="ota-hint">{t('debug.hint')}</p>

      <label className="field-group">
        <span className="field-caption">{t('debug.elfFile')}</span>
        <div className="field-row">
          <input
            className="flash-path"
            value={elfPath}
            placeholder={t('flash.noFileSelected')}
            onChange={(e) => {
              setElfPath(e.target.value)
              setMemoryMap(null)
              setFrames(null)
            }}
          />
          <button
            type="button"
            className="icon-button"
            title={t('common.browse')}
            onClick={() => void browseForElf()}
          >
            <FolderIcon />
          </button>
        </div>
      </label>

      <div className="debug-section">
        <h4>{t('debug.memoryMap.heading')}</h4>
        <div className="flash-actions">
          <button
            type="button"
            className="connect-button"
            disabled={!elfPath || mapBusy}
            onClick={() => void handleAnalyze()}
          >
            {mapBusy ? <Spinner /> : <SearchIcon />} {t('debug.memoryMap.analyze')}
          </button>
        </div>
        {mapError && <p className="connect-error">{mapError}</p>}
        {memoryMap && (
          <>
            <div className="debug-totals">
              <span>
                {t('debug.memoryMap.flashUsed', { size: formatBytes(memoryMap.flashBytes) })}
              </span>
              <span>{t('debug.memoryMap.ramUsed', { size: formatBytes(memoryMap.ramBytes) })}</span>
            </div>
            <div className="debug-table-wrap">
              <table className="debug-table">
                <thead>
                  <tr>
                    <th>{t('debug.memoryMap.section')}</th>
                    <th>{t('debug.memoryMap.kind')}</th>
                    <th>{t('debug.memoryMap.size')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {memoryMap.sections.map((s) => (
                    <tr key={s.name}>
                      <td className="mono">{s.name}</td>
                      <td>{s.kind}</td>
                      <td className="mono">{formatBytes(s.size)}</td>
                      <td className="debug-bar-cell">
                        <div
                          className="debug-bar"
                          style={{ width: `${(s.size / maxSectionSize) * 100}%` }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="debug-section">
        <h4>{t('debug.crashDecoder.heading')}</h4>
        <textarea
          className="debug-backtrace-input"
          value={backtraceText}
          placeholder={t('debug.crashDecoder.placeholder')}
          onChange={(e) => setBacktraceText(e.target.value)}
        />
        <div className="flash-actions">
          <button
            type="button"
            className="connect-button"
            disabled={!elfPath || !backtraceText.trim() || decodeBusy}
            onClick={() => void handleDecode()}
          >
            {decodeBusy ? <Spinner /> : <SearchIcon />} {t('debug.crashDecoder.decode')}
          </button>
        </div>
        {decodeError && <p className="connect-error">{decodeError}</p>}
        {frames && (
          <div className="debug-table-wrap">
            <table className="debug-table">
              <thead>
                <tr>
                  <th>{t('debug.crashDecoder.address')}</th>
                  <th>{t('debug.crashDecoder.function')}</th>
                  <th>{t('debug.crashDecoder.location')}</th>
                </tr>
              </thead>
              <tbody>
                {frames.map((f, i) => (
                  <tr key={i}>
                    <td className="mono">{formatAddress(f.address)}</td>
                    <td className="mono">{f.function ?? t('debug.crashDecoder.unknown')}</td>
                    <td className="mono">
                      {f.file ? (
                        <button
                          type="button"
                          className="debug-frame-location"
                          title={t('debug.crashDecoder.openInEditor')}
                          onClick={() => handleOpenInEditor(f)}
                        >
                          {f.file}:{f.line ?? '?'}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
