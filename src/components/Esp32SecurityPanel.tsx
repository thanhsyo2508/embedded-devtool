import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { burnEsp32Efuse, readEsp32EfuseSummary, type EfuseSecuritySummary } from '../api/flash'
import { RefreshIcon } from './icons'
import { Spinner } from './Spinner'
import { TypedConfirm } from './TypedConfirm'

/** Read-only eFuse summary + curated single-field burns (flash encryption
 * counter, secure boot enable, JTAG/UART-download disable) for the chip on
 * `port`. Only the fields espflash's own per-chip field tables define as
 * security-relevant are burnable — see esp32_security.rs for why this
 * stays a curated list rather than a free-form eFuse address editor. */
export function Esp32SecurityPanel({ port }: { port: string }) {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<EfuseSecuritySummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [burnValues, setBurnValues] = useState<Record<string, string>>({})

  const loadSummary = async () => {
    setLoading(true)
    setError(null)
    try {
      setSummary(await readEsp32EfuseSummary(port))
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const burnField = async (name: string) => {
    const value = Number(burnValues[name] ?? '1')
    if (!Number.isInteger(value) || value < 0) return
    try {
      await burnEsp32Efuse(port, name, value)
      await loadSummary()
    } catch (err) {
      window.alert(String(err))
    }
  }

  return (
    <div className="esp32-security">
      <p className="ota-hint">{t('esp32Security.hint')}</p>
      <button type="button" disabled={!port || loading} onClick={() => void loadSummary()}>
        {loading ? <Spinner /> : <RefreshIcon />}{' '}
        {loading ? t('flash.working') : t('esp32Security.readSummary')}
      </button>
      {error && <p className="connect-error">{error}</p>}

      {summary && (
        <>
          <div className="port-details">
            <div className="port-details-text">
              <span className="port-details-name">{summary.chip}</span>
            </div>
          </div>

          <div className="debug-table-wrap">
            <table className="debug-table">
              <thead>
                <tr>
                  <th>{t('esp32Security.field')}</th>
                  <th>{t('esp32Security.value')}</th>
                  <th>{t('esp32Security.bits')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.fields.map((f) => (
                  <tr key={f.name}>
                    <td className="mono">{f.name}</td>
                    <td className="mono">{f.value}</td>
                    <td className="mono">{f.bitCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <hr className="settings-divider" />
          <div className="settings-section-title">{t('esp32Security.burnTitle')}</div>
          <p className="ota-hint danger-text">{t('esp32Security.burnWarning')}</p>

          <div className="esp32-security-burn-list">
            {summary.fields.map((f) => (
              <div key={f.name} className="esp32-security-burn-row">
                <span className="mono">
                  {f.name} ({t('esp32Security.currentValue')}: {f.value})
                </span>
                <input
                  type="number"
                  min={0}
                  className="mono esp32-security-burn-input"
                  value={burnValues[f.name] ?? '1'}
                  onChange={(e) => setBurnValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                />
                <TypedConfirm
                  keyword="BURN"
                  label={t('esp32Security.burn')}
                  onConfirm={() => void burnField(f.name)}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
