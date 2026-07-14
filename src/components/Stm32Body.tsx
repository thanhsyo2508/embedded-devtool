import { useEffect, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useTranslation } from 'react-i18next'
import { listSerialPorts, onUsbPlugged, onUsbUnplugged, type PortInfo } from '../api/serial'
import { useStm32Store } from '../state/stm32Store'
import { authorizeFlash } from '../lib/flashLock'
import { encodeMemoryContent, type MemoryContentKind } from '../lib/memoryContent'
import { ChipIcon, FolderIcon, GearIcon, RefreshIcon, ZapIcon } from './icons'
import { Stm32MassProductionPanel } from './Stm32MassProductionPanel'
import { Stm32SecurityPanel } from './Stm32SecurityPanel'
import { CollapsibleSection } from './CollapsibleSection'

const MEMORY_CONTENT_KINDS: MemoryContentKind[] = ['text', 'hex', 'dec', 'json']

const STM32CUBEPROG_URL = 'https://www.st.com/en/development-tools/stm32cubeprog.html'

type Stm32Mode = 'single' | 'massProduction'

export function Stm32Body() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Stm32Mode>('single')
  const [ports, setPorts] = useState<PortInfo[]>([])
  const portSelectRef = useRef<HTMLSelectElement>(null)
  const [obName, setObName] = useState('RDP')
  const [obValue, setObValue] = useState('')
  const {
    cliPath,
    cliChecked,
    interfaceKind,
    uartPort,
    uartBaud,
    mcuInfo,
    detecting,
    filePath,
    address,
    verify,
    reset,
    busy,
    optionBytesText,
    log,
    checkCli,
    setInterfaceKind,
    setUartPort,
    setUartBaud,
    setFilePath,
    setAddress,
    setVerify,
    setReset,
    detectMcu,
    flash,
    eraseFull,
    readOptionBytes,
    writeOptionByte,
    writeMemory,
  } = useStm32Store()
  const [wmAddress, setWmAddress] = useState('0x08000000')
  const [wmKind, setWmKind] = useState<MemoryContentKind>('text')
  const [wmContent, setWmContent] = useState('')
  const [wmError, setWmError] = useState<string | null>(null)

  useEffect(() => {
    void checkCli()
    listSerialPorts()
      .then(setPorts)
      .catch(() => {})
  }, [checkCli])

  useEffect(() => {
    const refresh = () => {
      // Skip while the port <select> is open/focused — swapping its options
      // out from under an in-progress click risks flashing the wrong port.
      if (document.activeElement === portSelectRef.current) return
      listSerialPorts()
        .then(setPorts)
        .catch(() => {})
    }
    const unlistenPlugged = onUsbPlugged(refresh)
    const unlistenUnplugged = onUsbUnplugged(refresh)
    return () => {
      void unlistenPlugged.then((f) => f())
      void unlistenUnplugged.then((f) => f())
    }
  }, [])

  const browseForFile = async () => {
    const picked = await open({
      title: t('stm32.selectFirmwareTitle'),
      filters: [{ name: t('flash.firmwareFilterName'), extensions: ['bin', 'hex', 'elf'] }],
    })
    if (typeof picked === 'string') setFilePath(picked)
  }

  const handleEraseFull = () => {
    if (window.confirm(t('stm32.massEraseConfirm'))) {
      void eraseFull()
    }
  }

  const handleWriteOptionByte = () => {
    if (!obValue) return
    const isRdp = obName.trim().toUpperCase() === 'RDP'
    const warning = isRdp ? t('stm32.rdpWarning') : ''
    if (
      window.confirm(
        `${warning}${t('stm32.writeOptionByteConfirm', { name: obName, value: obValue })}`,
      )
    ) {
      void writeOptionByte(obName, obValue)
    }
  }

  const handleWriteMemory = () => {
    setWmError(null)
    let bytes: number[]
    try {
      bytes = encodeMemoryContent(wmKind, wmContent)
    } catch (err) {
      setWmError(err instanceof Error ? err.message : String(err))
      return
    }
    if (
      window.confirm(t('stm32.writeMemory.confirm', { count: bytes.length, address: wmAddress }))
    ) {
      void writeMemory(wmAddress, bytes)
    }
  }

  if (!cliChecked) {
    return <p className="connect-error">{t('stm32.checkingCli')}</p>
  }

  if (!cliPath) {
    return (
      <>
        <div className="port-details">
          <GearIcon className="port-details-icon" />
          <div className="port-details-text">
            <span className="port-details-name">{t('stm32.cliNotFound')}</span>
            <span>{t('stm32.cliNotFoundDetail')}</span>
          </div>
        </div>
        <div className="flash-actions">
          <button type="button" onClick={() => void openUrl(STM32CUBEPROG_URL)}>
            <GearIcon /> {t('stm32.downloadCli')}
          </button>
          <button type="button" onClick={() => void checkCli()}>
            <RefreshIcon /> {t('stm32.recheck')}
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="port-details">
        <ChipIcon className="port-details-icon" />
        <div className="port-details-text">
          <span className="mono">{cliPath}</span>
        </div>
      </div>

      <div className="seg">
        <span
          className={interfaceKind === 'swLink' ? 'on' : ''}
          onClick={() => setInterfaceKind('swLink')}
        >
          {t('stm32.stLink')}
        </span>
        <span
          className={interfaceKind === 'uart' ? 'on' : ''}
          onClick={() => setInterfaceKind('uart')}
        >
          {t('stm32.uartBootloader')}
        </span>
      </div>

      {interfaceKind === 'uart' && (
        <div className="flash-connect-row">
          <select
            ref={portSelectRef}
            value={uartPort}
            onChange={(e) => setUartPort(e.target.value)}
          >
            <option value="">{t('flash.selectPort')}</option>
            {ports.map((p) => (
              <option key={p.portName} value={p.portName}>
                {p.portName}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={uartBaud}
            onChange={(e) => setUartBaud(Number(e.target.value))}
          />
        </div>
      )}

      <button
        type="button"
        disabled={(interfaceKind === 'uart' && !uartPort) || detecting}
        onClick={() => void detectMcu()}
      >
        {detecting ? t('stm32.connecting') : t('stm32.detectMcu')}
      </button>

      {mcuInfo && (mcuInfo.deviceName ?? mcuInfo.deviceId) && (
        <div className="port-details">
          <ChipIcon className="port-details-icon" />
          <div className="port-details-text">
            <span className="port-details-name">
              {mcuInfo.deviceName ?? t('stm32.unknownDevice')}
            </span>
            {mcuInfo.deviceId && <span className="mono">{mcuInfo.deviceId}</span>}
          </div>
        </div>
      )}

      <div className="seg">
        <span className={mode === 'single' ? 'on' : ''} onClick={() => setMode('single')}>
          {t('flash.single')}
        </span>
        <span
          className={mode === 'massProduction' ? 'on' : ''}
          onClick={() => setMode('massProduction')}
        >
          {t('stm32.massProduction.tabLabel')}
        </span>
      </div>

      {mode === 'massProduction' && <Stm32MassProductionPanel />}

      {mode === 'single' && (
        <>
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

          <div className="field-grid">
            <label className="field-group">
              <span className="field-caption">{t('stm32.address')}</span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="mono"
              />
            </label>
            <label className="checkbox-field" style={{ alignSelf: 'end' }}>
              <input
                type="checkbox"
                checked={verify}
                onChange={(e) => setVerify(e.target.checked)}
              />
              <span>{t('stm32.verify')}</span>
            </label>
          </div>

          <label className="checkbox-field">
            <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} />
            <span>{t('stm32.resetAfterFlash')}</span>
          </label>

          <div className="flash-actions">
            <button type="button" className="flash-erase" disabled={busy} onClick={handleEraseFull}>
              <GearIcon /> {t('stm32.massErase')}
            </button>
            <button
              type="button"
              className="connect-button flash-go"
              disabled={!filePath || busy}
              onClick={() => {
                if (authorizeFlash()) void flash()
              }}
            >
              <ZapIcon /> {busy ? t('flash.working') : t('flash.flash')}
            </button>
          </div>

          <hr className="settings-divider" />

          <CollapsibleSection title={t('stm32.security.rdpTitle')}>
            <Stm32SecurityPanel />
          </CollapsibleSection>

          <CollapsibleSection title={t('stm32.optionBytesAdvanced')}>
            <p className="ota-hint">{t('stm32.optionBytesAdvancedHint')}</p>
            <button type="button" onClick={() => void readOptionBytes()}>
              {t('stm32.read')}
            </button>
            {optionBytesText && <div className="flash-log flash-ob-text">{optionBytesText}</div>}
            <div className="flash-connect-row">
              <input
                value={obName}
                onChange={(e) => setObName(e.target.value)}
                placeholder={t('stm32.obNamePlaceholder')}
              />
              <input
                value={obValue}
                onChange={(e) => setObValue(e.target.value)}
                placeholder={t('stm32.obValuePlaceholder')}
              />
              <button type="button" className="flash-erase" onClick={handleWriteOptionByte}>
                {t('stm32.write')}
              </button>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title={t('stm32.writeMemory.title')}>
            <p className="ota-hint">{t('stm32.writeMemory.hint')}</p>
            <div className="field-grid">
              <label className="field-group">
                <span className="field-caption">{t('stm32.address')}</span>
                <input
                  className="mono"
                  value={wmAddress}
                  onChange={(e) => setWmAddress(e.target.value)}
                />
              </label>
              <label className="field-group">
                <span className="field-caption">{t('stm32.writeMemory.kind')}</span>
                <select
                  value={wmKind}
                  onChange={(e) => setWmKind(e.target.value as MemoryContentKind)}
                >
                  {MEMORY_CONTENT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`stm32.writeMemory.kind${kind[0].toUpperCase()}${kind.slice(1)}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <textarea
              className="stm32-write-memory-content mono"
              value={wmContent}
              placeholder={t('stm32.writeMemory.contentPlaceholder')}
              onChange={(e) => setWmContent(e.target.value)}
            />
            {wmError && <p className="connect-error">{wmError}</p>}
            <div className="flash-actions">
              <button
                type="button"
                className="flash-erase"
                disabled={busy || !wmContent}
                onClick={handleWriteMemory}
              >
                {t('stm32.writeMemory.write')}
              </button>
            </div>
          </CollapsibleSection>

          <div className="flash-log">
            {log.length === 0 && <div className="flash-log-empty">{t('flash.noActivity')}</div>}
            {log.map((line, i) => (
              <div key={i} className="flash-log-line">
                {line}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
