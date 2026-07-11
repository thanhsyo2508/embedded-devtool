import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TabState } from '../state/tabsStore'
import { useUdpStore, type UdpDatagramRecord } from '../state/udpStore'
import { decodeText, looksBinary, toHexDump } from '../lib/payloadFormat'
import { relativeTime } from '../lib/relativeTime'
import { TrashIcon } from './icons'

// Stable reference for "no packets yet" — see the MqttPanel blank-screen
// bug this pattern was fixed for (a fresh `[]` literal inline in the
// selector would fabricate a new array every call and loop-crash the tab).
const EMPTY_DATAGRAMS: UdpDatagramRecord[] = []

export function UdpPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const datagrams = useUdpStore((s) => s.datagramsByTab[tab.id] ?? EMPTY_DATAGRAMS)
  const clearDatagrams = useUdpStore((s) => s.clearDatagrams)
  const [view, setView] = useState<'auto' | 'hex'>('auto')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="udp-panel">
      <div className="toolbar">
        <span className="line-count">{t('udp.packetCount', { count: datagrams.length })}</span>
        <button
          type="button"
          onClick={() => clearDatagrams(tab.id)}
          disabled={datagrams.length === 0}
        >
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
        {datagrams.length === 0 ? (
          <p className="mdns-empty">{t('udp.noDatagramsYet')}</p>
        ) : (
          [...datagrams].reverse().map((pkt, i) => {
            const asHex = view === 'hex' || looksBinary(pkt.data)
            return (
              <div key={datagrams.length - i} className="packet-entry">
                <div className="packet-meta">
                  <span className="mono packet-from">{pkt.from}</span>
                  <span>{relativeTime(pkt.atMs, now)}</span>
                  <span>{t('mqtt.byteCount', { count: pkt.data.length })}</span>
                </div>
                <pre className="mqtt-payload-view mono">
                  {(asHex ? toHexDump(pkt.data) : decodeText(pkt.data)) || t('mqtt.empty')}
                </pre>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
