import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import '@xterm/xterm/css/xterm.css'
import { useTabsStore, type TabState } from '../state/tabsStore'
import { forgetKnownHost, onNetworkData, sshResize, writeNetworkStream } from '../api/network'
import { keychainDeletePassword, keychainLoadPassword, keychainSavePassword } from '../api/keychain'
import { handleTerminalPathDragOver, handleTerminalPathDrop } from '../lib/terminalPathDrop'
import { TerminalSearchBar } from './TerminalSearchBar'
import { RepeatIcon } from './icons'

function pasteFromClipboard(term: Terminal) {
  void readText().then((text) => {
    if (text) term.paste(text)
  })
}

interface SshTerminalEntry {
  term: Terminal
  fitAddon: FitAddon
  searchAddon: SearchAddon
  /** The terminal's own DOM node, created once and re-parented (via plain
   * `appendChild`) into whichever container is currently mounted — moving
   * a node keeps its rendered content intact, unlike calling `term.open()`
   * again on a new element. */
  hostDiv: HTMLDivElement
  disposeForGood: () => void
  /** Reassigned on every mount (not just creation, see below) — the Ctrl+F
   * key handler is wired up once, at creation, but the component instance
   * (and its setShowSearch) is fresh on every switch-away-and-back remount,
   * so the handler must read this through `entry` at call time rather than
   * close over the very first mount's setter directly, or Ctrl+F would
   * silently stop opening the search bar after the first remount. */
  setShowSearch: (v: boolean) => void
}

// Module-level, outside React entirely: only a tab actually being *closed*
// should end an SSH session. Switching away from its tab and back must not
// — but PaneContent only ever renders the active tab, so SshPanel mounts
// and unmounts on every switch regardless. Keying live Terminal instances
// by tab id here decouples the PTY session's lifetime from the component's,
// so a switch-away-and-back finds the same terminal (full scrollback and
// all) instead of a fresh, empty one.
const sshTerminals = new Map<string, SshTerminalEntry>()

/** SSH is a real interactive PTY, not the line-oriented text every other
 * tab kind shows — this renders it with an actual terminal emulator
 * (xterm.js) instead of MonitorView, and keystrokes go straight to the
 * remote shell instead of through SendPanel's line-oriented send box. */
export function SshPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const reconnectTab = useTabsStore((s) => s.reconnectTab)
  // Prefilled with the password remembered from the last successful
  // connect (see tabsStore's ConnectionConfig doc comment — in-memory
  // only) so a plain retry is just one click; editable so a wrong-password
  // disconnect can be fixed without closing the tab and reconnecting from
  // scratch via the New Connection panel.
  const [password, setPassword] = useState(() =>
    tab.connectionConfig.kind === 'ssh' ? tab.connectionConfig.password : '',
  )
  const [reconnecting, setReconnecting] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [rememberPassword, setRememberPassword] = useState(false)
  const isKeyAuth =
    tab.connectionConfig.kind === 'ssh' && Boolean(tab.connectionConfig.privateKeyPath)

  // Stable per-connection identifier for the OS keychain entry -- not the
  // tab id, which is fresh every time this same connection is (re)opened
  // from the New Connection panel.
  const keychainKey = useMemo(() => {
    const config = tab.connectionConfig
    return config.kind === 'ssh' ? `ssh://${config.username}@${config.host}:${config.port}` : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  // Opt-in only: a password saved from an earlier session on this exact
  // connection is offered here, but never auto-filled anywhere else (see
  // ConnectPanel's "password intentionally never seeded" comment).
  useEffect(() => {
    if (!keychainKey) return
    keychainLoadPassword(keychainKey)
      .then((saved) => {
        if (saved !== null) {
          setPassword(saved)
          setRememberPassword(true)
        }
      })
      .catch(() => {})
  }, [keychainKey])

  const handleToggleRemember = (checked: boolean) => {
    setRememberPassword(checked)
    if (!keychainKey) return
    if (checked) {
      if (password) void keychainSavePassword(keychainKey, password).catch(() => {})
    } else {
      void keychainDeletePassword(keychainKey).catch(() => {})
    }
  }

  const handleReconnect = async () => {
    setReconnecting(true)
    try {
      await reconnectTab(tab.id, password)
      if (rememberPassword && keychainKey) {
        void keychainSavePassword(keychainKey, password).catch(() => {})
      }
    } finally {
      setReconnecting(false)
    }
  }

  // useLayoutEffect, not useEffect: fitAddon.fit() needs the container's
  // real layout size before the first paint, same reasoning as PlotDock's
  // uPlot sizing (see that component) — otherwise the first fit can measure
  // a 0x0 container and undersize the initial PTY.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    let entry = sshTerminals.get(tab.id)
    if (!entry) {
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: 13,
      })
      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      const searchAddon = new SearchAddon()
      term.loadAddon(searchAddon)
      const hostDiv = document.createElement('div')
      hostDiv.style.width = '100%'
      hostDiv.style.height = '100%'
      term.open(hostDiv)

      const dataDisposable = term.onData((data) => {
        void writeNetworkStream(tab.id, Array.from(new TextEncoder().encode(data)))
      })

      // Copy-on-select (PuTTY / most Linux terminals' convention) — Ctrl+C
      // is already spoken for (sends SIGINT to the remote shell), so
      // there's no keyboard copy shortcut; selecting text is the only
      // gesture for it.
      const selectionDisposable = term.onSelectionChange(() => {
        const selection = term.getSelection()
        if (selection) void writeText(selection)
      })

      // Ctrl+V's native browser paste depends on OS/webview clipboard
      // permissions that aren't reliable inside Tauri's webview, so paste
      // explicitly through the clipboard-manager plugin instead — same as
      // right-click, which is the more common paste gesture in terminal
      // apps (PuTTY, most Linux terminals) anyway.
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') return true
        const isPaste = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v'
        if (isPaste) {
          event.preventDefault()
          pasteFromClipboard(term)
          return false
        }
        const isFind = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f'
        if (isFind) {
          event.preventDefault()
          entry!.setShowSearch(true)
          return false
        }
        return true
      })

      const unlistenPromise = onNetworkData((batch) => {
        if (batch.id !== tab.id) return
        term.write(new Uint8Array(batch.data))
      })

      entry = {
        term,
        fitAddon,
        searchAddon,
        hostDiv,
        disposeForGood: () => {
          dataDisposable.dispose()
          selectionDisposable.dispose()
          void unlistenPromise.then((unlisten) => unlisten())
          term.dispose()
        },
        setShowSearch,
      }
      sshTerminals.set(tab.id, entry)
    }

    // Reassigned on every effect run, not just creation — see the field's
    // own doc comment on why (the Ctrl+F handler is wired up once, but a
    // remount after switching away gets a fresh setShowSearch).
    entry.setShowSearch = setShowSearch

    const { term, fitAddon, hostDiv } = entry
    container.appendChild(hostDiv)
    fitAddon.fit()
    // Without this, a freshly opened/switched-to tab doesn't have keyboard
    // focus at all — keystrokes (and native Ctrl+V paste, which only fires
    // on the focused element) silently go nowhere until the user clicks
    // into the terminal first.
    term.focus()
    void sshResize(tab.id, term.cols, term.rows).catch(() => {})

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      pasteFromClipboard(term)
    }
    container.addEventListener('contextmenu', handleContextMenu)

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      void sshResize(tab.id, term.cols, term.rows).catch(() => {})
    })
    resizeObserver.observe(container)

    return () => {
      container.removeEventListener('contextmenu', handleContextMenu)
      resizeObserver.disconnect()
      // hostDiv is deliberately left as-is (still holding its rendered
      // content) rather than removed — appendChild on the next mount will
      // re-parent it wherever it's needed, browser-native and lossless.
      // Only tear the session down for good when the tab itself is gone
      // (closed, not just switched away from) — both cases unmount this
      // component identically, so the tabs list is what distinguishes them.
      const stillOpen = useTabsStore.getState().tabs.some((t) => t.id === tab.id)
      if (!stillOpen) {
        sshTerminals.delete(tab.id)
        entry?.disposeForGood()
      }
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
        {tab.status !== 'open' && (
          <div className="ssh-reconnect">
            {/* A key-based tab has nothing to type — the stored key path
                (and passphrase, if any) is reused automatically, same as
                the SFTP sidebar's own reconnect. */}
            {!isKeyAuth && (
              <input
                type="password"
                value={password}
                placeholder={t('ssh.passwordPlaceholder')}
                disabled={reconnecting}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleReconnect()
                }}
              />
            )}
            <button type="button" disabled={reconnecting} onClick={() => void handleReconnect()}>
              <RepeatIcon /> {reconnecting ? t('ssh.reconnecting') : t('ssh.reconnect')}
            </button>
            {/* A rejected connection due to a changed host key (see
                core::known_hosts) is otherwise a permanent dead end from
                inside the app — this is the escape hatch for "I know the
                key legitimately changed (server reinstalled, etc.)". */}
            {tab.errorMessage?.toLowerCase().includes('host key') &&
              tab.connectionConfig.kind === 'ssh' && (
                <button
                  type="button"
                  title={t('ssh.forgetHostKeyHint')}
                  onClick={() => {
                    if (tab.connectionConfig.kind !== 'ssh') return
                    void forgetKnownHost(tab.connectionConfig.host, tab.connectionConfig.port)
                  }}
                >
                  {t('ssh.forgetHostKey')}
                </button>
              )}
            {!isKeyAuth && (
              <label className="ssh-remember-password" title={t('ssh.rememberPasswordHint')}>
                <input
                  type="checkbox"
                  checked={rememberPassword}
                  onChange={(e) => handleToggleRemember(e.target.checked)}
                />
                {t('ssh.rememberPassword')}
              </label>
            )}
          </div>
        )}
      </div>
      <div className="ssh-terminal-wrap">
        <div
          className="ssh-terminal"
          ref={containerRef}
          onDragOver={handleTerminalPathDragOver}
          onDrop={(e) => handleTerminalPathDrop(e, tab.id)}
        />
        {showSearch && sshTerminals.get(tab.id) && (
          <TerminalSearchBar
            searchAddon={sshTerminals.get(tab.id)!.searchAddon}
            onClose={() => setShowSearch(false)}
          />
        )}
      </div>
    </div>
  )
}
