import { useEffect, useState } from 'react'
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
        <span className="line-count">
          {datagrams.length} packet{datagrams.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={() => clearDatagrams(tab.id)}
          disabled={datagrams.length === 0}
        >
          <TrashIcon /> Clear
        </button>
        <div className="seg">
          <span className={view === 'auto' ? 'on' : ''} onClick={() => setView('auto')}>
            Text
          </span>
          <span className={view === 'hex' ? 'on' : ''} onClick={() => setView('hex')}>
            Hex
          </span>
        </div>
        {tab.status === 'closed' && <span className="tab-disconnected">Disconnected</span>}
        {tab.status === 'error' && <span className="tab-error">{tab.errorMessage}</span>}
      </div>

      <div className="packet-log">
        {datagrams.length === 0 ? (
          <p className="mdns-empty">No datagrams received yet.</p>
        ) : (
          [...datagrams].reverse().map((pkt, i) => {
            const asHex = view === 'hex' || looksBinary(pkt.data)
            return (
              <div key={datagrams.length - i} className="packet-entry">
                <div className="packet-meta">
                  <span className="mono packet-from">{pkt.from}</span>
                  <span>{relativeTime(pkt.atMs, now)}</span>
                  <span>
                    {pkt.data.length} byte{pkt.data.length === 1 ? '' : 's'}
                  </span>
                </div>
                <pre className="mqtt-payload-view mono">
                  {(asHex ? toHexDump(pkt.data) : decodeText(pkt.data)) || '(empty)'}
                </pre>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
