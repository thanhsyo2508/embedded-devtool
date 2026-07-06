import { useNetScanStore } from '../state/netScanStore'
import { SearchIcon, XIcon } from './icons'

export function DeepScanModal() {
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
            <SearchIcon /> Deep scan <span className="mono">{deepScanIp}</span>
          </span>
          <button type="button" className="icon-button" aria-label="Close" onClick={closeDeepScan}>
            <XIcon />
          </button>
        </div>

        <div className="field-row">
          <div className="field-group">
            <span className="field-caption">From port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={deepScanFrom}
              onChange={(e) => setDeepScanRange(Number(e.target.value), deepScanTo)}
            />
          </div>
          <div className="field-group">
            <span className="field-caption">To port</span>
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
            {deepScanScanning ? 'Scanning…' : 'Scan'}
          </button>
        </div>

        {deepScanScanning && deepScanHits.length === 0 && (
          <p className="mdns-empty">
            Scanning {deepScanFrom}–{deepScanTo}…
          </p>
        )}
        {!deepScanScanning && deepScanHits.length === 0 && (
          <p className="mdns-empty">No open ports found.</p>
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
