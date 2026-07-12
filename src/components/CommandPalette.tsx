import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CommandIcon } from './icons'

export interface PaletteCommand {
  id: string
  label: string
  category: string
  shortcut?: string
  run: () => void
}

/** Ctrl+K quick-open: type to filter every top-level action (open a panel,
 * new connection, save/open project, close/clear the focused tab...) and
 * run it with Enter — the app has grown enough top bar/toolbar icons that
 * finding one by name is often faster than hunting for its icon, and this
 * doubles as a live, always-accurate shortcut reference. */
export function CommandPalette({
  commands,
  onClose,
}: {
  commands: PaletteCommand[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q),
    )
  }, [commands, query])

  // Resets the selection whenever the query changes the filtered list —
  // adjusted during render rather than in an effect, per React's guidance
  // for resetting state derived from a changed value (same pattern as
  // ConnectPanel's presetsFor).
  const [queryForSelection, setQueryForSelection] = useState(query)
  if (query !== queryForSelection) {
    setQueryForSelection(query)
    setSelected(0)
  }

  const run = (command: PaletteCommand) => {
    command.run()
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const command = filtered[selected]
      if (command) run(command)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-input-row">
          <CommandIcon />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={t('commandPalette.placeholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="command-palette-list">
          {filtered.length === 0 && (
            <p className="command-palette-empty">{t('commandPalette.noMatches')}</p>
          )}
          {filtered.map((command, i) => (
            <button
              key={command.id}
              type="button"
              className={`command-palette-item ${i === selected ? 'on' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => run(command)}
            >
              <span className="command-palette-item-category">{command.category}</span>
              <span className="command-palette-item-label">{command.label}</span>
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
