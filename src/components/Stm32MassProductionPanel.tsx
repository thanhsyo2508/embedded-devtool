import { useEffect } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { useStm32MassProductionStore } from '../state/stm32MassProductionStore'
import { useStm32Store } from '../state/stm32Store'
import { useToastStore } from '../state/toastStore'
import { authorizeFlash } from '../lib/flashLock'
import type { ProvisionValueFormat } from '../api/flash'
import { DiskIcon, FolderIcon, PlayIcon, RefreshIcon } from './icons'
import { Spinner } from './Spinner'

const VALUE_FORMATS: ProvisionValueFormat[] = ['asciiDecimal', 'hexBytes']

/** Flashes the same firmware to many boards in a row, patching a unique
 * serial number/MAC/key into each copy first — the shared ST-Link/UART
 * interface config lives in Stm32Body above this; only the mass-
 * production-specific fields (file, patch spec, counter) live here. */
export function Stm32MassProductionPanel() {
  const { t } = useTranslation()
  const cliPath = useStm32Store((s) => s.cliPath)
  const {
    filePath,
    address,
    patchOffset,
    patchLength,
    valueFormat,
    startCounter,
    nextCounter,
    busy,
    log,
    entries,
    wireEventsOnce,
    setFilePath,
    setAddress,
    setPatchOffset,
    setPatchLength,
    setValueFormat,
    setStartCounter,
    resetCounter,
    flashNext,
  } = useStm32MassProductionStore()
  const addToast = useToastStore((s) => s.addToast)

  useEffect(() => {
    wireEventsOnce()
  }, [wireEventsOnce])

  const browseForFile = async () => {
    const picked = await open({
      title: t('stm32.selectFirmwareTitle'),
      filters: [{ name: t('flash.firmwareFilterName'), extensions: ['bin', 'hex'] }],
    })
    if (typeof picked === 'string') setFilePath(picked)
  }

  const handleExportCsv = async () => {
    const path = await save({
      defaultPath: 'production-log.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (!path) return
    const header = 'counter,value,success,message,timestamp\n'
    const rows = entries
      .slice()
      .reverse()
      .map(
        (e) =>
          `${e.counter},${e.value},${e.success},"${e.message.replace(/"/g, '""')}",${new Date(e.atMs).toISOString()}`,
      )
      .join('\n')
    try {
      await invoke('write_text_file', { path, contents: header + rows })
    } catch (err) {
      addToast('error', t('stm32.massProduction.exportCsvError', { message: String(err) }))
    }
  }

  const successCount = entries.filter((e) => e.success).length
  const failCount = entries.length - successCount

  return (
    <>
      <p className="ota-hint">{t('stm32.massProduction.hint')}</p>

      <label className="field-group">
        <span className="field-caption">{t('stm32.firmwareFile')}</span>
        <div className="field-row">
          <input
            className="flash-path"
            value={filePath}
            placeholder={t('flash.noFileSelected')}
            onChange={(e) => setFilePath(e.target.value)}
          />
          <button
            type="button"
            className="icon-button"
            title={t('common.browse')}
            onClick={() => void browseForFile()}
          >
            <FolderIcon />
          </button>
        </div>
      </label>

      <label className="field-group">
        <span className="field-caption">{t('stm32.address')}</span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} className="mono" />
      </label>

      <div className="field-grid">
        <label className="field-group">
          <span className="field-caption">{t('stm32.massProduction.patchOffset')}</span>
          <input
            value={patchOffset}
            onChange={(e) => setPatchOffset(e.target.value)}
            className="mono"
            disabled={busy}
          />
        </label>
        <label className="field-group">
          <span className="field-caption">{t('stm32.massProduction.patchLength')}</span>
          <input
            type="number"
            value={patchLength}
            onChange={(e) => setPatchLength(Number(e.target.value))}
            disabled={busy}
          />
        </label>
      </div>

      <label className="field-group">
        <span className="field-caption">{t('stm32.massProduction.valueFormat')}</span>
        <div className="seg">
          {VALUE_FORMATS.map((f) => (
            <span
              key={f}
              className={valueFormat === f ? 'on' : ''}
              onClick={() => setValueFormat(f)}
            >
              {t(`stm32.massProduction.format.${f}`)}
            </span>
          ))}
        </div>
      </label>

      <div className="field-grid">
        <label className="field-group">
          <span className="field-caption">{t('stm32.massProduction.startCounter')}</span>
          <input
            type="number"
            value={startCounter}
            onChange={(e) => setStartCounter(Number(e.target.value))}
            disabled={busy}
          />
        </label>
        <label className="field-group">
          <span className="field-caption">{t('stm32.massProduction.nextCounter')}</span>
          <input value={nextCounter} readOnly className="mono" />
        </label>
      </div>

      <div className="flash-actions">
        <button type="button" disabled={busy} onClick={resetCounter}>
          <RefreshIcon /> {t('stm32.massProduction.resetCounter')}
        </button>
        <button
          type="button"
          className="connect-button flash-go"
          disabled={!cliPath || !filePath || busy}
          onClick={() => {
            if (authorizeFlash()) void flashNext()
          }}
        >
          {busy ? <Spinner /> : <PlayIcon />}{' '}
          {busy ? t('flash.working') : t('stm32.massProduction.flashNext')}
        </button>
      </div>

      {entries.length > 0 && (
        <>
          <div className="debug-totals">
            <span>
              {t('stm32.massProduction.summary', {
                total: entries.length,
                success: successCount,
                failed: failCount,
              })}
            </span>
            <button
              type="button"
              className="icon-button"
              title={t('stm32.massProduction.exportCsv')}
              onClick={() => void handleExportCsv()}
            >
              <DiskIcon />
            </button>
          </div>
          <div className="debug-table-wrap">
            <table className="debug-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('stm32.massProduction.value')}</th>
                  <th>{t('stm32.massProduction.status')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={`${e.counter}-${e.atMs}`}>
                    <td className="mono">{e.counter}</td>
                    <td className="mono">{e.value}</td>
                    <td className={e.success ? 'mono' : 'mono connect-error'}>
                      {e.success ? '✓' : `✗ ${e.message}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="flash-log">
        {log.length === 0 && <div className="flash-log-empty">{t('flash.noActivity')}</div>}
        {log.map((line, i) => (
          <div key={i} className="flash-log-line">
            {line}
          </div>
        ))}
      </div>
    </>
  )
}
