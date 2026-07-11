import { useTranslation } from 'react-i18next'
import { useNetScanStore } from '../state/netScanStore'
import { SearchIcon, XIcon } from './icons'

export function DeepScanModal() {
  const { t } = useTranslation()
  const deepScanIp = useNetScanStore((s) => s.deepScanIp)
  const deepScanFrom = useNetScanStore((s) => s.deepScanFrom)
  const deepScanTo = useNetScanStore((s) => s.deepScanTo)
  const deepScanScanning = useNetScanStore((s) => s.deepScanScanning)
  const deepScanHits = useNetScanStore((s) => s.deepScanHits)
  const closeDeepScan = useNetScanStore((s) => s.closeDeepScan)
  const setDeepScanRange = useNetScanStore((s) => s.setDeepScanRange)
  const runDeepScan = useNetScanStore((s) => s.runDeepScan)

  if (!deepScanIp) return null

  const rangeInvalid = deepScanFrom < 1 || deepScanTo > 65535 || deepScanFrom > deepScanTo

  return (
    <div className="settings-overlay netscan-deep-overlay" onClick={closeDeepScan}>
      <div className="netscan-deep-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">
            <SearchIcon /> {t('netScan.deepScanTitle')} <span className="mono">{deepScanIp}</span>
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('common.close')}
            onClick={closeDeepScan}
          >
            <XIcon />
          </button>
        </div>

        <div className="field-row">
          <div className="field-group">
            <span className="field-caption">{t('netScan.fromPort')}</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={deepScanFrom}
              onChange={(e) => setDeepScanRange(Number(e.target.value), deepScanTo)}
            />
          </div>
          <div className="field-group">
            <span className="field-caption">{t('netScan.toPort')}</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={deepScanTo}
              onChange={(e) => setDeepScanRange(deepScanFrom, Number(e.target.value))}
            />
          </div>
          <button
            type="button"
            disabled={deepScanScanning || rangeInvalid}
            onClick={() => void runDeepScan()}
          >
            {deepScanScanning ? t('netScan.scanning') : t('netScan.scan')}
          </button>
        </div>

        {deepScanScanning && deepScanHits.length === 0 && (
          <p className="mdns-empty">
            {t('netScan.scanningRange', { from: deepScanFrom, to: deepScanTo })}
          </p>
        )}
        {!deepScanScanning && deepScanHits.length === 0 && (
          <p className="mdns-empty">{t('netScan.noOpenPorts')}</p>
        )}
        {deepScanHits.length > 0 && (
          <div className="netscan-ports">
            {deepScanHits.map((port) => (
              <span key={port} className="netscan-port-chip mono">
                {port}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
