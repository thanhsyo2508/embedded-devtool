import { useLayoutEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TabState } from '../state/tabsStore'
import { onNetworkData, sshResize, writeNetworkStream } from '../api/network'

/** SSH is a real interactive PTY, not the line-oriented text every other
 * tab kind shows — this renders it with an actual terminal emulator
 * (xterm.js) instead of MonitorView, and keystrokes go straight to the
 * remote shell instead of through SendPanel's line-oriented send box. */
export function SshPanel({ tab }: { tab: TabState }) {
  const containerRef = useRef<HTMLDivElement>(null)

  // useLayoutEffect, not useEffect: fitAddon.fit() needs the container's
  // real layout size before the first paint, same reasoning as PlotDock's
  // uPlot sizing (see that component) — otherwise the first fit can measure
  // a 0x0 container and undersize the initial PTY.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, Consolas, monospace',
      fontSize: 13,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    fitAddon.fit()

    const dataDisposable = term.onData((data) => {
      void writeNetworkStream(tab.id, Array.from(new TextEncoder().encode(data)))
    })

    void sshResize(tab.id, term.cols, term.rows).catch(() => {})

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      void sshResize(tab.id, term.cols, term.rows).catch(() => {})
    })
    resizeObserver.observe(container)

    const unlistenPromise = onNetworkData((batch) => {
      if (batch.id !== tab.id) return
      term.write(new Uint8Array(batch.data))
    })

    return () => {
      dataDisposable.dispose()
      resizeObserver.disconnect()
      void unlistenPromise.then((unlisten) => unlisten())
      term.dispose()
    }
  }, [tab.id])

  return (
    <div className="ssh-panel">
      <div className="toolbar">
        <span className="line-count">{tab.connectionLabel}</span>
        {tab.status === 'closed' && <span className="tab-disconnected">Disconnected</span>}
        {tab.status === 'error' && <span className="tab-error">{tab.errorMessage}</span>}
      </div>
      <div className="ssh-terminal" ref={containerRef} />
    </div>
  )
}
