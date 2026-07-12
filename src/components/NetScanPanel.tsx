import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNetScanStore, type NetScanRow } from '../state/netScanStore'
import { DeepScanModal } from './DeepScanModal'
import { GlobeIcon, RefreshIcon, SearchIcon, XIcon } from './icons'
import { Spinner } from './Spinner'

function ipSortKey(ip: string): number {
  const parts = ip.split('.').map(Number)
  return parts.reduce((acc, part) => acc * 256 + (Number.isFinite(part) ? part : 0), 0)
}

export function NetScanPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const commonPorts = useNetScanStore((s) => s.commonPorts)
  const cidr = useNetScanStore((s) => s.cidr)
  const scanning = useNetScanStore((s) => s.scanning)
  const rows = useNetScanStore((s) => s.rows)
  const wireEventsOnce = useNetScanStore((s) => s.wireEventsOnce)
  const loadCommonPorts = useNetScanStore((s) => s.loadCommonPorts)
  const detectSubnet = useNetScanStore((s) => s.detectSubnet)
  const setCidr = useNetScanStore((s) => s.setCidr)
  const startScan = useNetScanStore((s) => s.startScan)
  const openDeepScan = useNetScanStore((s) => s.openDeepScan)
  const deepScanIp = useNetScanStore((s) => s.deepScanIp)

  useEffect(() => {
    wireEventsOnce()
    void loadCommonPorts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!cidr) void detectSubnet()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rowList: NetScanRow[] = Object.values(rows).sort(
    (a, b) => ipSortKey(a.ip) - ipSortKey(b.ip),
  )

  return (
    <>
      <div className="settings-overlay netscan-overlay" onClick={onClose}>
        <div className="netscan-panel" onClick={(e) => e.stopPropagation()}>
          <div className="settings-header">
            <span className="settings-title">
              <GlobeIcon /> {t('netScan.title')}
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

          <div className="field-row">
            <input
              type="text"
              className="mono"
              value={cidr}
              placeholder="192.168.1.0/24"
              onChange={(e) => setCidr(e.target.value)}
            />
            <button
              type="button"
              className="icon-button"
              title={t('netScan.detectSubnet')}
              onClick={() => void detectSubnet()}
            >
              <RefreshIcon />
            </button>
            <button type="button" disabled={scanning || !cidr} onClick={() => void startScan()}>
              {scanning && <Spinner />} {scanning ? t('netScan.scanning') : t('netScan.scan')}
            </button>
          </div>

          <div className="netscan-table-wrap">
            <table className="netscan-table">
              <thead>
                <tr>
                  <th>IP</th>
                  <th>MAC</th>
                  <th>{t('netScan.name')}</th>
                  {commonPorts.map(([port, name]) => (
                    <th key={port} title={name}>
                      {port}
                    </th>
                  ))}
                  <th>{t('netScan.deepScan')}</th>
                </tr>
              </thead>
              <tbody>
                {rowList.length === 0 && (
                  <tr>
                    <td className="netscan-empty" colSpan={commonPorts.length + 4}>
                      {scanning ? t('netScan.scanning') : t('netScan.noHostsFound')}
                    </td>
                  </tr>
                )}
                {rowList.map((row) => (
                  <tr key={row.ip}>
                    <td className="mono">{row.ip}</td>
                    <td className="mono">{row.mac ?? '—'}</td>
                    <td>{row.name ?? '—'}</td>
                    {commonPorts.map(([port]) => (
                      <td key={port} className="netscan-cell">
                        {row.openPorts.has(port) ? '✓' : ''}
                      </td>
                    ))}
                    <td>
                      <button
                        type="button"
                        className="icon-button"
                        title={t('netScan.deepScanIp', { ip: row.ip })}
                        onClick={() => openDeepScan(row.ip)}
                      >
                        <SearchIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {deepScanIp && <DeepScanModal />}
    </>
  )
}
