import { useState, type KeyboardEvent } from 'react'
import { useTabsStore, type LineEnding, type TabState } from '../state/tabsStore'
import { parseHex } from '../lib/hex'

type SendMode = 'text' | 'hex'

export function SendPanel({ tab }: { tab: TabState }) {
  const send = useTabsStore((s) => s.send)
  const sendBytes = useTabsStore((s) => s.sendBytes)
  const setLineEnding = useTabsStore((s) => s.setLineEnding)
  const [mode, setMode] = useState<SendMode>('text')
  const [text, setText] = useState('')
  const [historyIndex, setHistoryIndex] = useState(-1)

  const hexBytes = mode === 'hex' ? parseHex(text) : null
  const hexInvalid = mode === 'hex' && hexBytes === null

  const doSend = () => {
    if (text.length === 0) return
    if (mode === 'hex') {
      if (hexBytes === null) return
      void sendBytes(tab.id, hexBytes, text, true)
    } else {
      void send(tab.id, text)
    }
    setText('')
    setHistoryIndex(-1)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      doSend()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(historyIndex + 1, tab.sendHistory.length - 1)
      if (next >= 0) {
        setHistoryIndex(next)
        setText(tab.sendHistory[next])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = historyIndex - 1
      setHistoryIndex(next)
      setText(next >= 0 ? tab.sendHistory[next] : '')
    }
  }

  return (
    <div className="send-panel">
      <div className="seg">
        <span className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')}>
          text
        </span>
        <span className={mode === 'hex' ? 'on' : ''} onClick={() => setMode('hex')}>
          hex
        </span>
      </div>
      <select
        value={tab.lineEnding}
        onChange={(e) => setLineEnding(tab.id, e.target.value as LineEnding)}
      >
        <option value="none">None</option>
        <option value="cr">CR</option>
        <option value="lf">LF</option>
        <option value="crlf">CRLF</option>
      </select>
      <input
        type="text"
        className={hexInvalid ? 'invalid' : ''}
        value={text}
        placeholder={mode === 'hex' ? 'e.g. 01 02 FF' : 'Type a command and press Enter'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={tab.status !== 'open'}
      />
      <button
        type="button"
        onClick={doSend}
        disabled={tab.status !== 'open' || text.length === 0 || hexInvalid}
      >
        Send
      </button>
    </div>
  )
}
