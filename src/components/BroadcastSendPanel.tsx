import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTabsStore } from '../state/tabsStore'
import { parseHex } from '../lib/hex'
import { XIcon, ZapIcon } from './icons'

type Mode = 'text' | 'hex'

/** Send one command to several open connections at once — for a production
 * bench or multi-node test where the same command goes to every device.
 * Reached from the command palette; reuses the per-tab send/sendBytes so
 * each tab still applies its own line-ending etc. */
export function BroadcastSendPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const tabs = useTabsStore((s) => s.tabs)
  const send = useTabsStore((s) => s.send)
  const sendBytes = useTabsStore((s) => s.sendBytes)

  const openTabs = tabs.filter((tb) => tb.status === 'open')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(openTabs.map((tb) => tb.id)))
  const [mode, setMode] = useState<Mode>('text')
  const [text, setText] = useState('')

  const hexBytes = mode === 'hex' ? parseHex(text) : null
  const hexInvalid = mode === 'hex' && text.trim().length > 0 && hexBytes === null

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const canSend =
    text.length > 0 && selected.size > 0 && !(mode === 'hex' && (hexBytes === null || hexInvalid))

  const doSend = () => {
    if (!canSend) return
    for (const tab of openTabs) {
      if (!selected.has(tab.id)) continue
      if (mode === 'hex') {
        if (hexBytes) void sendBytes(tab.id, hexBytes, text, true)
      } else {
        void send(tab.id, text)
      }
    }
    onClose()
  }

  return (
    <div className="settings-overlay broadcast-overlay" onClick={onClose}>
      <div className="broadcast-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">{t('broadcast.title')}</span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <XIcon />
          </button>
        </div>

        <p className="ota-hint">{t('broadcast.hint')}</p>

        {openTabs.length === 0 ? (
          <p className="flash-log-empty">{t('broadcast.noOpenTabs')}</p>
        ) : (
          <>
            <div className="broadcast-targets">
              {openTabs.map((tab) => (
                <label key={tab.id} className="broadcast-target">
                  <input
                    type="checkbox"
                    checked={selected.has(tab.id)}
                    onChange={() => toggle(tab.id)}
                  />
                  <span>{tab.customLabel ?? tab.connectionLabel}</span>
                </label>
              ))}
            </div>

            <div className="broadcast-compose">
              <div className="seg">
                <span className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')}>
                  {t('send.text')}
                </span>
                <span className={mode === 'hex' ? 'on' : ''} onClick={() => setMode('hex')}>
                  {t('send.hex')}
                </span>
              </div>
              <input
                className={hexInvalid ? 'invalid' : ''}
                value={text}
                placeholder={mode === 'hex' ? t('send.hexPlaceholder') : t('send.textPlaceholder')}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') doSend()
                }}
              />
            </div>

            <button
              type="button"
              className="connect-button broadcast-send"
              disabled={!canSend}
              onClick={doSend}
            >
              <ZapIcon /> {t('broadcast.send', { count: selected.size })}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
