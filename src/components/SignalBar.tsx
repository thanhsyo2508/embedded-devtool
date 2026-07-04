import { useEffect, useState } from 'react'
import { readSerialSignals, setSerialDtr, setSerialRts, type SignalState } from '../api/serial'
import { useTabsStore, type TabState } from '../state/tabsStore'

// DTR/RTS are outputs this side drives — there is no way to read back their
// actual line state from the OS, so this toggle reflects what we last set,
// not a live readout (unlike CTS/DSR/RI/CD, which are real inputs polled
// from the device below).
export function SignalBar({ tab }: { tab: TabState }) {
  const disconnectTab = useTabsStore((s) => s.disconnectTab)
  const reconnectTab = useTabsStore((s) => s.reconnectTab)
  const [dtr, setDtr] = useState(false)
  const [rts, setRts] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [signals, setSignals] = useState<SignalState | null>(null)

  useEffect(() => {
    if (tab.status !== 'open' || tab.connectionKind !== 'serial') return
    let cancelled = false
    const poll = () => {
      readSerialSignals(tab.id)
        .then((s) => {
          if (!cancelled) setSignals(s)
        })
        .catch(() => {})
    }
    poll()
    const interval = setInterval(poll, 1000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [tab.id, tab.status, tab.connectionKind])

  const toggleDtr = () => {
    const next = !dtr
    setDtr(next)
    void setSerialDtr(tab.id, next)
  }

  const toggleRts = () => {
    const next = !rts
    setRts(next)
    void setSerialRts(tab.id, next)
  }

  const handleReconnect = () => {
    setReconnecting(true)
    void reconnectTab(tab.id).finally(() => setReconnecting(false))
  }

  // When RS485 half-duplex is on, RTS is toggled automatically around every
  // write — a manual toggle here would fight that and leave the line in an
  // unpredictable state.
  const rs485Active =
    tab.connectionConfig.kind === 'serial' && Boolean(tab.connectionConfig.req.rs485AutoRts)

  return (
    <div className="signal-bar">
      {tab.connectionKind === 'serial' && (
        <>
          <button
            type="button"
            className={`signal-toggle ${dtr ? 'on' : ''}`}
            title="Data Terminal Ready (writable — click to toggle)"
            onClick={toggleDtr}
          >
            DTR
          </button>
          <button
            type="button"
            className={`signal-toggle ${rts ? 'on' : ''}`}
            title={
              rs485Active
                ? 'Controlled automatically by RS485 half-duplex mode'
                : 'Request To Send (writable — click to toggle)'
            }
            disabled={rs485Active}
            onClick={toggleRts}
          >
            RTS
          </button>
          <span className="signal-divider" />
          <span className={`signal-light ${signals?.cts ? 'on' : ''}`} title="Clear To Send">
            CTS
          </span>
          <span className={`signal-light ${signals?.dsr ? 'on' : ''}`} title="Data Set Ready">
            DSR
          </span>
          <span className={`signal-light ${signals?.ri ? 'on' : ''}`} title="Ring Indicator">
            RI
          </span>
          <span className={`signal-light ${signals?.cd ? 'on' : ''}`} title="Carrier Detect">
            CD
          </span>
        </>
      )}
      <div className="signal-bar-grow" />
      {tab.status === 'open' ? (
        <button
          type="button"
          className="disconnect-button"
          onClick={() => void disconnectTab(tab.id)}
        >
          Disconnect
        </button>
      ) : (
        <button
          type="button"
          className="reconnect-button"
          disabled={reconnecting}
          onClick={handleReconnect}
        >
          {reconnecting ? 'Reconnecting…' : 'Reconnect'}
        </button>
      )}
    </div>
  )
}
