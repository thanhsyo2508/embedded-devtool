import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { XIcon } from './icons'

export interface EditorMatch {
  start: number
  end: number
}

/** Shared by SftpEditorTabs.tsx/FtpEditorTabs.tsx: a small find bar over the
 * open file's own text, toggled by Ctrl+F — same shortcuts as
 * TerminalSearchBar (Enter/Shift+Enter step next/previous, Escape closes).
 * Unlike the terminal's own search (backed by xterm's SearchAddon), this is
 * a plain case-insensitive substring search over the file's content string;
 * `onJump` is left to the caller (move the textarea's selection into view)
 * so this component stays protocol-agnostic — neither editor depends on
 * the other's store. */
export function EditorFindBar({
  content,
  onJump,
  onQueryChange,
  onCurrentIndexChange,
  onClose,
  placeholder,
}: {
  content: string
  onJump: (match: EditorMatch) => void
  /** Fires on every query change so the caller can highlight *every* match
   * inline (not just the current one this component itself jumps to) — see
   * sftpFileLanguage.ts's `highlightForPath`. */
  onQueryChange: (query: string) => void
  /** Fires whenever which match is "current" changes (typing, Enter,
   * ↑/↓) — `undefined` when there's nothing to highlight (no query, or no
   * matches) — so the caller can give that one occurrence a stronger
   * highlight than the rest. */
  onCurrentIndexChange: (index: number | undefined) => void
  onClose: () => void
  placeholder: string
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const matches = useMemo(() => {
    if (!query) return []
    const out: EditorMatch[] = []
    const haystack = content.toLowerCase()
    const needle = query.toLowerCase()
    let from = 0
    while (from <= haystack.length) {
      const at = haystack.indexOf(needle, from)
      if (at === -1) break
      out.push({ start: at, end: at + query.length })
      from = at + 1
    }
    return out
  }, [content, query])

  const currentIndex =
    matches.length === 0 ? 0 : ((index % matches.length) + matches.length) % matches.length

  useEffect(() => {
    if (matches.length === 0) {
      onCurrentIndexChange(undefined)
      return
    }
    onJump(matches[currentIndex])
    onCurrentIndexChange(currentIndex)
    // Only the match itself (identified by matches/currentIndex) should
    // re-trigger a jump — `onJump`/`onCurrentIndexChange` are fresh
    // closures every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, currentIndex])

  const step = (delta: number) => setIndex((i) => i + delta)

  return (
    <div className="editor-find-bar">
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value)
          setIndex(0)
          onQueryChange(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      <span className="editor-find-bar-count">
        {query ? `${matches.length > 0 ? currentIndex + 1 : 0}/${matches.length}` : ''}
      </span>
      <button
        type="button"
        onClick={() => step(-1)}
        title={t('ssh.searchPrevious')}
        disabled={matches.length === 0}
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => step(1)}
        title={t('ssh.searchNext')}
        disabled={matches.length === 0}
      >
        ↓
      </button>
      <button type="button" className="icon-button" onClick={onClose}>
        <XIcon />
      </button>
    </div>
  )
}
