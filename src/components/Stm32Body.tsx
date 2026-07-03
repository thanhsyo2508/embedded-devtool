import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { listSerialPorts, type PortInfo } from '../api/serial'
import { useStm32Store } from '../state/stm32Store'
import { ChipIcon, FolderIcon, GearIcon, RefreshIcon, ZapIcon } from './icons'

const STM32CUBEPROG_URL = 'https://www.st.com/en/development-tools/stm32cubeprog.html'

export function Stm32Body() {
  const [ports, setPorts] = useState<PortInfo[]>([])
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
  } = useStm32Store()

  useEffect(() => {
    void checkCli()
    listSerialPorts()
      .then(setPorts)
      .catch(() => {})
  }, [checkCli])

  const browseForFile = async () => {
    const picked = await open({
      title: 'Select firmware .bin/.hex/.elf',
      filters: [{ name: 'Firmware', extensions: ['bin', 'hex', 'elf'] }],
    })
    if (typeof picked === 'string') setFilePath(picked)
  }

  const handleEraseFull = () => {
    if (window.confirm('Mass erase the entire chip? This cannot be undone.')) {
      void eraseFull()
    }
  }

  const handleWriteOptionByte = () => {
    if (!obValue) return
    const isRdp = obName.trim().toUpperCase() === 'RDP'
    const warning = isRdp
      ? 'WARNING: changing RDP (readout protection) can PERMANENTLY lock debug access to this chip if set incorrectly. This cannot always be undone.\n\n'
      : ''
    if (window.confirm(`${warning}Write option byte ${obName}=${obValue}?`)) {
      void writeOptionByte(obName, obValue)
    }
  }

  if (!cliChecked) {
    return <p className="connect-error">Checking for STM32CubeProgrammer…</p>
  }

  if (!cliPath) {
    return (
      <>
        <div className="port-details">
          <GearIcon className="port-details-icon" />
          <div className="port-details-text">
            <span className="port-details-name">STM32_Programmer_CLI not found</span>
            <span>
              It cannot be bundled with EDT — ST's license does not permit redistributing it.
              Install STM32CubeProgrammer, then recheck below.
            </span>
          </div>
        </div>
        <div className="flash-actions">
          <button type="button" onClick={() => void openUrl(STM32CUBEPROG_URL)}>
            <GearIcon /> Download STM32CubeProgrammer
          </button>
          <button type="button" onClick={() => void checkCli()}>
            <RefreshIcon /> Recheck
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
          ST-Link (SWD)
        </span>
        <span
          className={interfaceKind === 'uart' ? 'on' : ''}
          onClick={() => setInterfaceKind('uart')}
        >
          UART bootloader
        </span>
      </div>

      {interfaceKind === 'uart' && (
        <div className="flash-connect-row">
          <select value={uartPort} onChange={(e) => setUartPort(e.target.value)}>
            <option value="">Select port…</option>
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
        {detecting ? 'Connecting…' : 'Detect MCU'}
      </button>

      {mcuInfo && (mcuInfo.deviceName ?? mcuInfo.deviceId) && (
        <div className="port-details">
          <ChipIcon className="port-details-icon" />
          <div className="port-details-text">
            <span className="port-details-name">{mcuInfo.deviceName ?? 'Unknown device'}</span>
            {mcuInfo.deviceId && <span className="mono">{mcuInfo.deviceId}</span>}
          </div>
        </div>
      )}

      <label className="field-group">
        <span className="field-caption">Firmware file</span>
        <div className="field-row">
          <input className="flash-path" value={filePath} placeholder="No file selected" readOnly />
          <button
            type="button"
            className="icon-button"
            title="Browse"
            onClick={() => void browseForFile()}
          >
            <FolderIcon />
          </button>
        </div>
      </label>

      <div className="field-grid">
        <label className="field-group">
          <span className="field-caption">Address</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} className="mono" />
        </label>
        <label className="checkbox-field" style={{ alignSelf: 'end' }}>
          <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
          <span>Verify</span>
        </label>
      </div>

      <label className="checkbox-field">
        <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} />
        <span>Reset after flash</span>
      </label>

      <div className="flash-actions">
        <button type="button" className="flash-erase" disabled={busy} onClick={handleEraseFull}>
          <GearIcon /> Mass erase
        </button>
        <button
          type="button"
          className="connect-button flash-go"
          disabled={!filePath || busy}
          onClick={() => void flash()}
        >
          <ZapIcon /> {busy ? 'Working…' : 'Flash'}
        </button>
      </div>

      <hr className="settings-divider" />

      <div className="settings-row">
        <span>Option bytes</span>
        <button type="button" onClick={() => void readOptionBytes()}>
          Read
        </button>
      </div>
      {optionBytesText && <div className="flash-log flash-ob-text">{optionBytesText}</div>}
      <div className="flash-connect-row">
        <input
          value={obName}
          onChange={(e) => setObName(e.target.value)}
          placeholder="Name (e.g. RDP)"
        />
        <input
          value={obValue}
          onChange={(e) => setObValue(e.target.value)}
          placeholder="Value (e.g. 0xBB)"
        />
        <button type="button" className="flash-erase" onClick={handleWriteOptionByte}>
          Write
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
  )
}
