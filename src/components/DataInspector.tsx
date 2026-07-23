import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseHex } from '../lib/hex'
import { inspectBytes, type Endianness } from '../lib/dataInspect'
import { decodeStruct } from '../lib/structDecode'
import { useStructTemplateStore } from '../state/structTemplateStore'
import { LibraryRow } from './LibraryRow'
import { XIcon } from './icons'

type Mode = 'values' | 'struct'

const DEFAULT_TEMPLATE = `// one field per line: <type> <name>
// types: int8/16/32/64, uint8/16/32/64, float32/64,
//        char[N], bytes[N], pad[N]
uint16 id
float32 temp
uint8 flags`

/** Decodes a run of bytes as int/uint/float in either endianness ("Values"),
 * or against a named C-struct-like field layout ("Struct") — opened from the
 * monitor's right-click "Inspect bytes" on a selection, with the hex
 * prefilled and editable so it doubles as a standalone scratch decoder. */
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
  const [mode, setMode] = useState<Mode>('values')
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE)

  const templates = useStructTemplateStore((s) => s.items)
  const saveTemplate = useStructTemplateStore((s) => s.save)
  const deleteTemplate = useStructTemplateStore((s) => s.remove)

  const bytes = useMemo(() => parseHex(hex), [hex])
  const result = useMemo(
    () => (mode === 'values' && bytes && bytes.length > 0 ? inspectBytes(bytes, endian) : null),
    [mode, bytes, endian],
  )
  const structResult = useMemo(
    () => (mode === 'struct' && bytes ? decodeStruct(bytes, template, endian) : null),
    [mode, bytes, template, endian],
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

        <div className="seg data-inspector-mode">
          <span className={mode === 'values' ? 'on' : ''} onClick={() => setMode('values')}>
            {t('dataInspector.modeValues')}
          </span>
          <span className={mode === 'struct' ? 'on' : ''} onClick={() => setMode('struct')}>
            {t('dataInspector.modeStruct')}
          </span>
        </div>

        {hex.trim() && !bytes && <p className="connect-error">{t('dataInspector.invalidHex')}</p>}

        {mode === 'values' && result && (
          <div className="data-inspector-grid">
            {rows.map(([label, value]) => (
              <div key={label} className="data-inspector-row">
                <span className="data-inspector-type">{label}</span>
                <span className="mono data-inspector-value">{value}</span>
              </div>
            ))}
          </div>
        )}

        {mode === 'struct' && (
          <>
            <LibraryRow
              label={t('dataInspector.templateLabel')}
              items={templates}
              onLoad={(tpl) => setTemplate(tpl.template)}
              onSave={(name) => saveTemplate(name, { template })}
              onDelete={deleteTemplate}
            />
            <textarea
              className="mono data-inspector-template"
              value={template}
              spellCheck={false}
              onChange={(e) => setTemplate(e.target.value)}
              rows={6}
            />
            {structResult?.templateError && (
              <p className="connect-error">{structResult.templateError}</p>
            )}
            {structResult && structResult.fields.length > 0 && (
              <div className="data-inspector-grid">
                {structResult.fields.map((f, i) => (
                  <div key={i} className="data-inspector-row">
                    <span className="data-inspector-type">
                      {f.name} <span className="data-inspector-fieldtype">{f.type}</span>
                    </span>
                    <span className="mono data-inspector-value">{f.value}</span>
                  </div>
                ))}
              </div>
            )}
            {structResult?.truncated && (
              <p className="ota-hint">{t('dataInspector.structTruncated')}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
