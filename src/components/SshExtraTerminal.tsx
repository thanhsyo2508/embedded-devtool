import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import '@xterm/xterm/css/xterm.css'
import { onNetworkData, sshResize, writeNetworkStream } from '../api/network'
import { useSshTerminalsStore } from '../state/sshTerminalsStore'
import { handleTerminalPathDragOver, handleTerminalPathDrop } from '../lib/terminalPathDrop'

function pasteFromClipboard(term: Terminal) {
  void readText().then((text) => {
    if (text) term.paste(text)
  })
}

interface ExtraTerminalEntry {
  term: Terminal
  fitAddon: FitAddon
  hostDiv: HTMLDivElement
  disposeForGood: () => void
}

// Deliberately a separate module-level map from SshPanel's own
// `sshTerminals` — extra terminals are a fully independent lifecycle (see
// sshTerminalsStore's module doc: each is its own SSH connection, not a
// second channel on the tab's primary SshStream), so there's no shared
// mutable state with the tab's default terminal at all.
const extraTerminals = new Map<string, ExtraTerminalEntry>()

/** One "extra" terminal within an SSH tab's terminal dock (VSCode-style "+"
 * in the integrated terminal panel) — the same xterm.js mount/resize
 * plumbing as SshPanel's default terminal, but a deliberately separate,
 * smaller component rather than extending SshPanel itself: no
 * reconnect/password/keychain UI (a dead extra terminal is just closed and
 * a new one opened — no retry-in-place for v1), and keeping it standalone
 * means SshPanel's own code for the tab's default terminal is untouched by
 * this feature, so it can't regress. */
export function SshExtraTerminal({ tabId, terminalId }: { tabId: string; terminalId: string }) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const connecting = useSshTerminalsStore((s) => s.connecting[terminalId])
  const error = useSshTerminalsStore((s) => s.errors[terminalId])

  // useLayoutEffect, not useEffect — same reasoning as SshPanel's own mount
  // effect: fitAddon.fit() needs real layout size before first paint.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    let entry = extraTerminals.get(terminalId)
    if (!entry) {
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'ui-monospace, Consolas, monospace',
        fontSize: 13,
      })
      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      const hostDiv = document.createElement('div')
      hostDiv.style.width = '100%'
      hostDiv.style.height = '100%'
      term.open(hostDiv)

      const dataDisposable = term.onData((data) => {
        void writeNetworkStream(terminalId, Array.from(new TextEncoder().encode(data)))
      })
      const selectionDisposable = term.onSelectionChange(() => {
        const selection = term.getSelection()
        if (selection) void writeText(selection)
      })
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') return true
        const isPaste = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v'
        if (!isPaste) return true
        event.preventDefault()
        pasteFromClipboard(term)
        return false
      })
      const unlistenPromise = onNetworkData((batch) => {
        if (batch.id !== terminalId) return
        term.write(new Uint8Array(batch.data))
      })

      entry = {
        term,
        fitAddon,
        hostDiv,
        disposeForGood: () => {
          dataDisposable.dispose()
          selectionDisposable.dispose()
          void unlistenPromise.then((unlisten) => unlisten())
          term.dispose()
        },
      }
      extraTerminals.set(terminalId, entry)
    }

    const { term, fitAddon, hostDiv } = entry
    container.appendChild(hostDiv)
    fitAddon.fit()
    term.focus()
    void sshResize(terminalId, term.cols, term.rows).catch(() => {})

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      pasteFromClipboard(term)
    }
    container.addEventListener('contextmenu', handleContextMenu)

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      void sshResize(terminalId, term.cols, term.rows).catch(() => {})
    })
    resizeObserver.observe(container)

    return () => {
      container.removeEventListener('contextmenu', handleContextMenu)
      resizeObserver.disconnect()
      // Same "leave hostDiv as-is, only tear down for good when it's truly
      // gone" reasoning as SshPanel's own effect — this terminal is "gone"
      // once sshTerminalsStore no longer lists it in any group for this
      // tab (closed via its own × button), not on every switch-away-and-
      // back unmount.
      const stillOpen = (useSshTerminalsStore.getState().groups[tabId] ?? []).some((g) =>
        g.terminalIds.includes(terminalId),
      )
      if (!stillOpen) {
        extraTerminals.delete(terminalId)
        entry?.disposeForGood()
      }
    }
  }, [tabId, terminalId])

  return (
    <div className="ssh-panel">
      <div className="toolbar">
        {connecting && <span className="line-count">{t('ssh.sftp.connecting')}</span>}
        {error && <span className="tab-error">{error}</span>}
      </div>
      <div
        className="ssh-terminal"
        ref={containerRef}
        onDragOver={handleTerminalPathDragOver}
        onDrop={(e) => handleTerminalPathDrop(e, terminalId)}
      />
    </div>
  )
}
