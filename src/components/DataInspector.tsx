import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseHex } from '../lib/hex'
import { inspectBytes, type Endianness } from '../lib/dataInspect'
import { XIcon } from './icons'

/** Decodes a run of bytes as int/uint/float in either endianness — opened
 * from the monitor's right-click "Inspect bytes" on a selection, with the
 * hex prefilled and editable so it doubles as a standalone scratch decoder. */
export function DataInspector({
  initialHex,
  onClose,
}: {
  initialHex: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [hex, setHex] = useState(initialHex)
  const [endian, setEndian] = useState<Endianness>('le')

  const bytes = useMemo(() => parseHex(hex), [hex])
  const result = useMemo(
    () => (bytes && bytes.length > 0 ? inspectBytes(bytes, endian) : null),
    [bytes, endian],
  )

  const rows: [string, string | undefined][] = result
    ? [
        ['int8', result.int8],
        ['uint8', result.uint8],
        ['int16', result.int16],
        ['uint16', result.uint16],
        ['int32', result.int32],
        ['uint32', result.uint32],
        ['int64', result.int64],
        ['uint64', result.uint64],
        ['float32', result.float32],
        ['float64', result.float64],
        [t('dataInspector.ascii'), result.ascii],
        [t('dataInspector.binary'), result.binary],
      ]
    : []

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="data-inspector" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">{t('dataInspector.title')}</span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <XIcon />
          </button>
        </div>

        <div className="data-inspector-controls">
          <input
            className="mono data-inspector-hex"
            value={hex}
            placeholder={t('dataInspector.hexPlaceholder')}
            onChange={(e) => setHex(e.target.value)}
          />
          <div className="seg">
            <span className={endian === 'le' ? 'on' : ''} onClick={() => setEndian('le')}>
              {t('dataInspector.littleEndian')}
            </span>
            <span className={endian === 'be' ? 'on' : ''} onClick={() => setEndian('be')}>
              {t('dataInspector.bigEndian')}
            </span>
          </div>
        </div>

        {hex.trim() && !bytes && <p className="connect-error">{t('dataInspector.invalidHex')}</p>}

        {result && (
          <div className="data-inspector-grid">
            {rows.map(([label, value]) => (
              <div key={label} className="data-inspector-row">
                <span className="data-inspector-type">{label}</span>
                <span className="mono data-inspector-value">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
