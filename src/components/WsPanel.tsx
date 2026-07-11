import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TabState } from '../state/tabsStore'
import { useWsStore, type WsFrameRecord } from '../state/wsStore'
import { decodeText, looksBinary, toHexDump } from '../lib/payloadFormat'
import { relativeTime } from '../lib/relativeTime'
import { TrashIcon } from './icons'

// Stable reference for "no frames yet" — see the MqttPanel blank-screen bug
// this pattern was fixed for (a fresh `[]` literal inline in the selector
// would fabricate a new array every call and loop-crash the tab).
const EMPTY_FRAMES: WsFrameRecord[] = []

export function WsPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const frames = useWsStore((s) => s.framesByTab[tab.id] ?? EMPTY_FRAMES)
  const clearFrames = useWsStore((s) => s.clearFrames)
  const sendText = useWsStore((s) => s.sendText)
  const [view, setView] = useState<'auto' | 'hex'>('auto')
  const [now, setNow] = useState(() => Date.now())
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const handleSend = () => {
    if (text.length === 0) return
    setSending(true)
    void sendText(tab.id, text)
      .then(() => setText(''))
      .finally(() => setSending(false))
  }

  return (
    <div className="ws-panel">
      <div className="toolbar">
        <span className="line-count">{t('ws.frameCount', { count: frames.length })}</span>
        <button type="button" onClick={() => clearFrames(tab.id)} disabled={frames.length === 0}>
          <TrashIcon /> {t('monitor.clear')}
        </button>
        <div className="seg">
          <span className={view === 'auto' ? 'on' : ''} onClick={() => setView('auto')}>
            {t('mqtt.text')}
          </span>
          <span className={view === 'hex' ? 'on' : ''} onClick={() => setView('hex')}>
            {t('mqtt.hexLabel')}
          </span>
        </div>
        {tab.status === 'closed' && (
          <span className="tab-disconnected">{t('monitor.disconnected')}</span>
        )}
        {tab.status === 'error' && <span className="tab-error">{tab.errorMessage}</span>}
      </div>

      <div className="packet-log">
        {frames.length === 0 ? (
          <p className="mdns-empty">{t('ws.noFramesYet')}</p>
        ) : (
          [...frames].reverse().map((frame, i) => {
            const asHex = view === 'hex' || (frame.kind === 'binary' && looksBinary(frame.data))
            return (
              <div key={frames.length - i} className="packet-entry">
                <div className="packet-meta">
                  <span className={`ws-frame-kind ${frame.kind}`}>
                    {t(`ws.kind.${frame.kind}`)}
                  </span>
                  <span>{relativeTime(frame.atMs, now)}</span>
                  <span>{t('mqtt.byteCount', { count: frame.data.length })}</span>
                </div>
                <pre className="mqtt-payload-view mono">
                  {(asHex ? toHexDump(frame.data) : decodeText(frame.data)) || t('mqtt.empty')}
                </pre>
              </div>
            )
          })
        )}
      </div>

      <div className="ws-send-text">
        <input
          type="text"
          value={text}
          placeholder={t('ws.sendTextPlaceholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          disabled={tab.status !== 'open'}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={tab.status !== 'open' || text.length === 0 || sending}
        >
          {t('ws.sendText')}
        </button>
      </div>
    </div>
  )
}
