import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import '@xterm/xterm/css/xterm.css'
import type { TabState } from '../state/tabsStore'
import { onNetworkData, sshResize, writeNetworkStream } from '../api/network'

function pasteFromClipboard(term: Terminal) {
  void readText().then((text) => {
    if (text) term.paste(text)
  })
}

/** SSH is a real interactive PTY, not the line-oriented text every other
 * tab kind shows — this renders it with an actual terminal emulator
 * (xterm.js) instead of MonitorView, and keystrokes go straight to the
 * remote shell instead of through SendPanel's line-oriented send box. */
export function SshPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
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
    // Without this, a freshly opened/switched-to tab doesn't have keyboard
    // focus at all — keystrokes (and native Ctrl+V paste, which only fires
    // on the focused element) silently go nowhere until the user clicks
    // into the terminal first.
    term.focus()

    const dataDisposable = term.onData((data) => {
      void writeNetworkStream(tab.id, Array.from(new TextEncoder().encode(data)))
    })

    // Copy-on-select (PuTTY / most Linux terminals' convention) — Ctrl+C is
    // already spoken for (sends SIGINT to the remote shell), so there's no
    // keyboard copy shortcut; selecting text is the only gesture for it.
    const selectionDisposable = term.onSelectionChange(() => {
      const selection = term.getSelection()
      if (selection) void writeText(selection)
    })

    // Ctrl+V's native browser paste depends on OS/webview clipboard
    // permissions that aren't reliable inside Tauri's webview, so paste
    // explicitly through the clipboard-manager plugin instead — same as
    // right-click, which is the more common paste gesture in terminal apps
    // (PuTTY, most Linux terminals) anyway.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const isPaste = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v'
      if (!isPaste) return true
      event.preventDefault()
      pasteFromClipboard(term)
      return false
    })

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      pasteFromClipboard(term)
    }
    container.addEventListener('contextmenu', handleContextMenu)

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
      selectionDisposable.dispose()
      container.removeEventListener('contextmenu', handleContextMenu)
      resizeObserver.disconnect()
      void unlistenPromise.then((unlisten) => unlisten())
      term.dispose()
    }
  }, [tab.id])

  return (
    <div className="ssh-panel">
      <div className="toolbar">
        <span className="line-count">{tab.connectionLabel}</span>
        {tab.status === 'closed' && (
          <span className="tab-disconnected">{t('monitor.disconnected')}</span>
        )}
        {tab.status === 'error' && <span className="tab-error">{tab.errorMessage}</span>}
      </div>
      <div className="ssh-terminal" ref={containerRef} />
    </div>
  )
}
