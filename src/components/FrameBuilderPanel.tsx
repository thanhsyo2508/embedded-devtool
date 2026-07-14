import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useTabsStore, type TabState } from '../state/tabsStore'
import { useFrameBuilderStore, DEFAULT_FRAME_FIELDS } from '../state/frameBuilderStore'
import {
  encodeFrame,
  newFrameField,
  type FrameField,
  type FrameFieldType,
} from '../lib/frameBuilder'
import { formatHex } from '../lib/hex'
import { CHECKSUM_MODES } from '../lib/crc'
import { PlusIcon, TrashIcon, ZapIcon } from './icons'

const FIELD_TYPES: FrameFieldType[] = ['hex', 'text', 'uint8', 'uint16', 'uint32', 'length', 'crc']
const VALUELESS: FrameFieldType[] = ['length', 'crc']
const ENDIAN_TYPES: FrameFieldType[] = ['uint16', 'uint32', 'length']

/** Compose a binary frame (literal bytes, text, integers, an auto length,
 * an auto CRC) and send it to this tab — a toolbar flyout like Filters or
 * the Script panel. Draft fields live in frameBuilderStore, keyed by tab. */
export function FrameBuilderPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const sendBytes = useTabsStore((s) => s.sendBytes)
  const fields = useFrameBuilderStore((s) => s.fieldsByTab[tab.id]) ?? DEFAULT_FRAME_FIELDS
  const setFields = useFrameBuilderStore((s) => s.setFields)

  const encoded = useMemo(() => encodeFrame(fields), [fields])

  const update = (id: string, patch: Partial<FrameField>) =>
    setFields(
      tab.id,
      fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    )
  const remove = (id: string) =>
    setFields(
      tab.id,
      fields.filter((f) => f.id !== id),
    )
  const add = () => setFields(tab.id, [...fields, newFrameField('hex')])

  const handleSend = () => {
    if (!encoded.bytes || encoded.bytes.length === 0) return
    void sendBytes(tab.id, encoded.bytes, `frame:${formatHex(encoded.bytes)}`, true, 'none')
  }

  return (
    <div className="frame-builder">
      <div className="frame-builder-fields">
        {fields.map((field) => (
          <div className="frame-field-row" key={field.id}>
            <select
              value={field.type}
              onChange={(e) => update(field.id, { type: e.target.value as FrameFieldType })}
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`frameBuilder.type.${type}`)}
                </option>
              ))}
            </select>

            {!VALUELESS.includes(field.type) && (
              <input
                className="frame-field-value"
                value={field.value}
                placeholder={t(
                  `frameBuilder.placeholder.${field.type === 'text' ? 'text' : field.type === 'hex' ? 'hex' : 'int'}`,
                )}
                onChange={(e) => update(field.id, { value: e.target.value })}
              />
            )}

            {field.type === 'length' && (
              <select
                value={field.lengthWidth}
                onChange={(e) =>
                  update(field.id, { lengthWidth: Number(e.target.value) as 1 | 2 | 4 })
                }
              >
                <option value={1}>1 B</option>
                <option value={2}>2 B</option>
                <option value={4}>4 B</option>
              </select>
            )}

            {field.type === 'crc' && (
              <select
                value={field.crcMode}
                onChange={(e) =>
                  update(field.id, { crcMode: e.target.value as FrameField['crcMode'] })
                }
              >
                {CHECKSUM_MODES.filter((m) => m.value !== 'none').map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}

            {ENDIAN_TYPES.includes(field.type) && (
              <select
                value={field.endian}
                onChange={(e) =>
                  update(field.id, { endian: e.target.value as FrameField['endian'] })
                }
              >
                <option value="le">LE</option>
                <option value="be">BE</option>
              </select>
            )}

            <button
              type="button"
              className="icon-button"
              aria-label={t('common.remove')}
              onClick={() => remove(field.id)}
            >
              <TrashIcon />
            </button>
          </div>
        ))}
        <button type="button" className="flash-add-segment" onClick={add}>
          <PlusIcon /> {t('frameBuilder.addField')}
        </button>
      </div>

      <div className="frame-builder-preview">
        <span className="field-caption">{t('frameBuilder.preview')}</span>
        {encoded.error ? (
          <span className="connect-error">{encoded.error}</span>
        ) : (
          <span className="mono frame-builder-hex">
            {encoded.bytes && encoded.bytes.length > 0
              ? formatHex(encoded.bytes)
              : t('frameBuilder.empty')}
          </span>
        )}
      </div>

      <button
        type="button"
        className="connect-button frame-builder-send"
        disabled={!encoded.bytes || encoded.bytes.length === 0 || tab.status !== 'open'}
        onClick={handleSend}
      >
        <ZapIcon /> {t('frameBuilder.send')}
      </button>
    </div>
  )
}
