import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SearchAddon } from '@xterm/addon-search'
import { XIcon } from './icons'

/** Shared by SshPanel.tsx and SshExtraTerminal.tsx: a small find bar over
 * the terminal, toggled by Ctrl+F. Enter/Shift+Enter step to the
 * next/previous match, Escape closes it — same shortcuts as a browser's
 * own find bar, which most users already know. */
export function TerminalSearchBar({
  searchAddon,
  onClose,
}: {
  searchAddon: SearchAddon
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const find = (query_: string, backwards: boolean) => {
    if (!query_) return
    if (backwards) searchAddon.findPrevious(query_)
    else searchAddon.findNext(query_)
  }

  return (
    <div className="terminal-search-bar">
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder={t('ssh.searchTerminalPlaceholder')}
        onChange={(e) => {
          setQuery(e.target.value)
          find(e.target.value, false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            find(query, e.shiftKey)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <button type="button" onClick={() => find(query, true)} title={t('ssh.searchPrevious')}>
        ↑
      </button>
      <button type="button" onClick={() => find(query, false)} title={t('ssh.searchNext')}>
        ↓
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={() => {
          searchAddon.clearDecorations()
          onClose()
        }}
      >
        <XIcon />
      </button>
    </div>
  )
}
