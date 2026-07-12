import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'
import { mdnsScan, type MdnsService } from '../api/network'
import { useOtaStore } from '../state/otaStore'
import { FolderIcon, GlobeIcon, ZapIcon } from './icons'
import { Spinner } from './Spinner'

const ARDUINO_OTA_SERVICE = '_arduino._tcp.local.'
const SCAN_MS = 3000

/** ESP32 OTA-over-WiFi via the ArduinoOTA "espota" protocol — flashes a
 * device already running ArduinoOTA.h without a USB cable. Separate from
 * the serial ESP32 flash flow entirely (no port picker, no chip detect —
 * the device does its own bootloader handoff once the transfer completes).
 * Rendered as a third top-level target next to ESP32/STM32 in FlashPanel. */
export function OtaPanel() {
  const { t } = useTranslation()
  const {
    host,
    port,
    password,
    firmwarePath,
    busy,
    phase,
    progressCurrent,
    progressTotal,
    log,
    setHost,
    setPort,
    setPassword,
    setFirmwarePath,
    flash,
    wireEventsOnce,
  } = useOtaStore()
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState<MdnsService[] | null>(null)

  useEffect(() => {
    wireEventsOnce()
  }, [wireEventsOnce])

  const browseForFile = async () => {
    const picked = await open({
      title: t('ota.selectFirmwareTitle'),
      filters: [{ name: t('flash.firmwareFilterName'), extensions: ['bin'] }],
    })
    if (typeof picked === 'string') setFirmwarePath(picked)
  }

  const handleScan = async () => {
    setScanning(true)
    setScanResults(null)
    try {
      setScanResults(await mdnsScan(ARDUINO_OTA_SERVICE, SCAN_MS))
    } finally {
      setScanning(false)
    }
  }

  const applyDiscovered = (svc: MdnsService) => {
    setHost(svc.addresses[0] ?? svc.hostname)
    setPort(svc.port)
  }

  const progressPct = progressTotal > 0 ? Math.round((progressCurrent / progressTotal) * 100) : 0

  return (
    <div className="ota-panel">
      <p className="ota-hint">{t('ota.hint')}</p>

      <div className="mdns-discover">
        <div className="field-row">
          <button type="button" disabled={scanning} onClick={() => void handleScan()}>
            <GlobeIcon /> {scanning ? t('connect.scanning') : t('ota.scanForDevices')}
          </button>
        </div>
        {scanResults !== null &&
          (scanResults.length === 0 ? (
            <p className="mdns-empty">{t('connect.noDevicesFound')}</p>
          ) : (
            <div className="mdns-results">
              {scanResults.map((svc) => (
                <button
                  key={svc.fullname}
                  type="button"
                  className="mdns-result"
                  title={t('connect.useThisDeviceAddress')}
                  onClick={() => applyDiscovered(svc)}
                >
                  <span className="mdns-name">{svc.fullname.split('.')[0]}</span>
                  <span className="mono">
                    {svc.addresses[0] ?? svc.hostname}:{svc.port}
                  </span>
                </button>
              ))}
            </div>
          ))}
      </div>

      <div className="field-grid">
        <label className="field-group">
          <span className="field-caption">
            <GlobeIcon /> {t('connect.host')}
          </span>
          <input
            type="text"
            value={host}
            placeholder="192.168.1.50"
            onChange={(e) => setHost(e.target.value)}
          />
        </label>
        <label className="field-group">
          <span className="field-caption">{t('connect.port')}</span>
          <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
        </label>
      </div>
      <label className="field-group">
        <span className="field-caption">{t('ota.password')}</span>
        <input
          type="password"
          value={password}
          placeholder={t('ota.passwordPlaceholder')}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      <label className="field-group">
        <span className="field-caption">{t('stm32.firmwareFile')}</span>
        <div className="field-row">
          <input
            className="flash-path"
            value={firmwarePath}
            placeholder={t('flash.noFileSelected')}
            readOnly
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

      {busy && phase === 'writing' && progressTotal > 0 && (
        <div className="flash-progress">
          <div className="flash-progress-bar">
            <div className="flash-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="mono">{progressPct}%</span>
        </div>
      )}

      <div className="flash-actions">
        <button
          type="button"
          className="connect-button flash-go"
          disabled={!host || !firmwarePath || busy}
          onClick={() => void flash()}
        >
          {busy ? <Spinner /> : <ZapIcon />} {busy ? t('flash.working') : t('ota.flashOverWifi')}
        </button>
      </div>

      <div className="flash-log">
        {log.length === 0 && <div className="flash-log-empty">{t('flash.noActivity')}</div>}
        {log.map((line, i) => (
          <div key={i} className="flash-log-line">
            {line}
          </div>
        ))}
      </div>
    </div>
  )
}
