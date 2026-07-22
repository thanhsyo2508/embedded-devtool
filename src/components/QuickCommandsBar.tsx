import { useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useTabsStore, type LineEnding, type TabState } from '../state/tabsStore'
import { useQuickCommandProfilesStore, type QuickCommand } from '../state/quickCommandProfilesStore'
import { parseHex } from '../lib/hex'
import { PlusIcon, RowsIcon, TrashIcon } from './icons'

const INDENT = '  '
const AUTO_PAIRS: Record<string, string> = { '{': '}', '[': ']' }

function lineIndent(text: string, pos: number): string {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1
  return /^[ \t]*/.exec(text.slice(lineStart, pos))?.[0] ?? ''
}

function setCaret(el: HTMLTextAreaElement, pos: number) {
  requestAnimationFrame(() => {
    el.selectionStart = el.selectionEnd = pos
  })
}

function newCommandId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim()
  return (trimmed.startsWith('{') || trimmed.startsWith('[')) && isValidJson(trimmed)
}

/** Pretty-prints for editing; returns the input unchanged if it isn't
 * valid JSON (e.g. while the user is still mid-edit). */
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** Compacts to one line for storage/sending — a quick command is sent as a
 * single write with one trailing line ending, so embedded newlines from
 * pretty-printing would fragment it for any device reading line-by-line. */
function minifyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text))
  } catch {
    return text
  }
}

// A single always-visible, single-row strip (not a togglable side panel like
// Filters/Triggers) — the point of a "quick" command is one click to fire
// it, so it stays in view. Kept to one compact row (horizontally scrolling,
// not wrapping) so it doesn't eat vertical space the way a full editable
// list (à la FilterBar) would once a profile has more than a few commands.
export function QuickCommandsBar({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const profiles = useQuickCommandProfilesStore((s) => s.items)
  const saveProfile = useQuickCommandProfilesStore((s) => s.save)
  const deleteProfile = useQuickCommandProfilesStore((s) => s.remove)
  const setQuickCommandProfile = useTabsStore((s) => s.setQuickCommandProfile)
  const send = useTabsStore((s) => s.send)
  const sendBytes = useTabsStore((s) => s.sendBytes)

  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formLabel, setFormLabel] = useState('')
  const [formText, setFormText] = useState('')
  const [formHex, setFormHex] = useState(false)
  const [formJson, setFormJson] = useState(false)
  const [formLineEnding, setFormLineEnding] = useState<LineEnding | ''>('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [wrapped, setWrapped] = useState(false)

  const profile = profiles.find((p) => p.id === tab.quickCommandProfileId) ?? null
  const formHexInvalid = formHex && parseHex(formText) === null
  const formJsonInvalid = formJson && formText.trim().length > 0 && !isValidJson(formText)

  const runCommand = (cmd: QuickCommand) => {
    if (tab.status !== 'open') return
    if (cmd.isHex) {
      const bytes = parseHex(cmd.text)
      if (bytes && bytes.length > 0) void sendBytes(tab.id, bytes, cmd.text, true, cmd.lineEnding)
    } else if (cmd.text.length > 0) {
      void send(tab.id, cmd.text, cmd.lineEnding)
    }
  }

  const persistCommands = (commands: QuickCommand[]) => {
    if (!profile) return
    saveProfile(profile.name, { commands })
  }

  const handleNewProfile = () => {
    const name = window.prompt(t('quickCommands.newProfilePrompt'))
    if (!name) return
    saveProfile(name, { commands: [] })
    const created = useQuickCommandProfilesStore.getState().items.find((p) => p.name === name)
    if (created) setQuickCommandProfile(tab.id, created.id)
  }

  const handleDeleteProfile = () => {
    if (!profile) return
    if (!window.confirm(t('quickCommands.deleteProfileConfirm', { name: profile.name }))) return
    deleteProfile(profile.id)
    setQuickCommandProfile(tab.id, null)
  }

  const resetForm = () => {
    setAdding(false)
    setEditingId(null)
    setFormLabel('')
    setFormText('')
    setFormHex(false)
    setFormJson(false)
    setFormLineEnding('')
  }

  const startEdit = (cmd: QuickCommand) => {
    setAdding(false)
    setEditingId(cmd.id)
    setFormLabel(cmd.label)
    setFormHex(cmd.isHex)
    setFormLineEnding(cmd.lineEnding ?? '')
    const asJson = !cmd.isHex && looksLikeJson(cmd.text)
    setFormJson(asJson)
    setFormText(asJson ? prettyJson(cmd.text) : cmd.text)
  }

  const submitForm = () => {
    if (!profile || formText.trim().length === 0 || formHexInvalid || formJsonInvalid) return
    const text = formJson ? minifyJson(formText) : formText
    const lineEnding = formLineEnding || undefined
    if (editingId) {
      persistCommands(
        profile.commands.map((c) =>
          c.id === editingId
            ? { ...c, label: formLabel.trim(), text, isHex: formHex, lineEnding }
            : c,
        ),
      )
    } else {
      const cmd: QuickCommand = {
        id: newCommandId(),
        label: formLabel.trim(),
        text,
        isHex: formHex,
        lineEnding,
      }
      persistCommands([...profile.commands, cmd])
    }
    resetForm()
  }

  const handleJsonKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    const { selectionStart, selectionEnd, value } = el
    const before = value[selectionStart - 1]
    const after = value[selectionStart]
    const hasSelection = selectionStart !== selectionEnd

    if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) {
        const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
        if (value.slice(lineStart, lineStart + INDENT.length) === INDENT) {
          setFormText(value.slice(0, lineStart) + value.slice(lineStart + INDENT.length))
          setCaret(el, Math.max(lineStart, selectionStart - INDENT.length))
        }
      } else {
        setFormText(value.slice(0, selectionStart) + INDENT + value.slice(selectionEnd))
        setCaret(el, selectionStart + INDENT.length)
      }
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      const indent = lineIndent(value, selectionStart)
      const opensNewBlock = before === '{' || before === '['
      const closesSameBlock = opensNewBlock && AUTO_PAIRS[before] === after
      if (closesSameBlock) {
        const insert = `\n${indent}${INDENT}\n${indent}`
        setFormText(value.slice(0, selectionStart) + insert + value.slice(selectionEnd))
        setCaret(el, selectionStart + 1 + indent.length + INDENT.length)
      } else {
        const insert = `\n${indent}${opensNewBlock ? INDENT : ''}`
        setFormText(value.slice(0, selectionStart) + insert + value.slice(selectionEnd))
        setCaret(el, selectionStart + insert.length)
      }
      return
    }

    if (!hasSelection && e.key in AUTO_PAIRS) {
      e.preventDefault()
      const closer = AUTO_PAIRS[e.key]
      setFormText(value.slice(0, selectionStart) + e.key + closer + value.slice(selectionEnd))
      setCaret(el, selectionStart + 1)
      return
    }

    if (!hasSelection && e.key === '"') {
      e.preventDefault()
      if (after === '"') {
        setCaret(el, selectionStart + 1)
      } else {
        setFormText(value.slice(0, selectionStart) + '""' + value.slice(selectionEnd))
        setCaret(el, selectionStart + 1)
      }
      return
    }

    if (!hasSelection && (e.key === '}' || e.key === ']') && after === e.key) {
      e.preventDefault()
      setCaret(el, selectionStart + 1)
      return
    }

    if (!hasSelection && e.key === 'Backspace' && AUTO_PAIRS[before] === after) {
      e.preventDefault()
      setFormText(value.slice(0, selectionStart - 1) + value.slice(selectionStart + 1))
      setCaret(el, selectionStart - 1)
    }
  }

  const removeCommand = (id: string) => {
    if (!profile) return
    persistCommands(profile.commands.filter((c) => c.id !== id))
    if (editingId === id) resetForm()
  }

  const handleDrop = (targetId: string) => {
    if (!profile || !dragId || dragId === targetId) return
    const commands = [...profile.commands]
    const fromIndex = commands.findIndex((c) => c.id === dragId)
    const toIndex = commands.findIndex((c) => c.id === targetId)
    setDragId(null)
    if (fromIndex === -1 || toIndex === -1) return
    const [moved] = commands.splice(fromIndex, 1)
    commands.splice(toIndex, 0, moved)
    persistCommands(commands)
  }

  return (
    <>
      <div className={`quick-commands-bar ${wrapped ? 'wrapped' : ''}`}>
        <select
          className="quick-command-profile-select"
          value={profile?.id ?? ''}
          onChange={(e) => setQuickCommandProfile(tab.id, e.target.value || null)}
        >
          <option value="">{t('quickCommands.selectPlaceholder')}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-button"
          aria-label={t('quickCommands.newProfile')}
          title={t('quickCommands.newProfile')}
          onClick={handleNewProfile}
        >
          <PlusIcon />
        </button>
        {profile && (
          <button
            type="button"
            className="icon-button"
            aria-label={t('quickCommands.deleteProfile')}
            title={t('quickCommands.deleteProfileTitle', { name: profile.name })}
            onClick={handleDeleteProfile}
          >
            <TrashIcon />
          </button>
        )}
        {profile && (
          <button
            type="button"
            className={`icon-button ${wrapped ? 'on' : ''}`}
            aria-label={t('quickCommands.wrapRowsTitle')}
            aria-pressed={wrapped}
            title={t('quickCommands.wrapRowsTitle')}
            onClick={() => setWrapped((w) => !w)}
          >
            <RowsIcon />
          </button>
        )}
        {profile && (
          <div className={`quick-command-chips ${wrapped ? 'wrapped' : ''}`}>
            {profile.commands.map((cmd) => (
              <div
                key={cmd.id}
                className={`quick-command-chip ${tab.status !== 'open' ? 'disabled' : ''}`}
                draggable
                onDragStart={() => setDragId(cmd.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(cmd.id)}
                onClick={() => runCommand(cmd)}
                title={cmd.text}
              >
                <span className="quick-command-label">{cmd.label || cmd.text}</span>
                {wrapped && (
                  <span className="quick-command-detail">
                    {cmd.label && <span className="quick-command-text">{cmd.text}</span>}
                    {cmd.isHex && <span className="quick-command-badge">{t('send.hex')}</span>}
                    {cmd.lineEnding && (
                      <span className="quick-command-badge">{cmd.lineEnding.toUpperCase()}</span>
                    )}
                  </span>
                )}
                <button
                  type="button"
                  className="quick-command-edit"
                  aria-label={t('quickCommands.editCommand')}
                  onClick={(e) => {
                    e.stopPropagation()
                    startEdit(cmd)
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="quick-command-remove"
                  aria-label={t('quickCommands.removeCommand')}
                  onClick={(e) => {
                    e.stopPropagation()
                    removeCommand(cmd.id)
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="quick-command-chip quick-command-add"
              onClick={() => {
                resetForm()
                setAdding(true)
              }}
            >
              <PlusIcon /> {t('common.add')}
            </button>
          </div>
        )}
      </div>
      {(adding || editingId) && profile && (
        <div className="quick-command-form">
          <div className="quick-command-form-controls">
            <input
              type="text"
              placeholder={t('quickCommands.labelOptional')}
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
            />
            {!formJson && (
              <input
                type="text"
                className={formHexInvalid ? 'invalid' : ''}
                placeholder={formHex ? t('send.hexPlaceholder') : t('quickCommands.commandText')}
                value={formText}
                onChange={(e) => setFormText(e.target.value)}
              />
            )}
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={formHex}
                onChange={(e) => {
                  const checked = e.target.checked
                  setFormHex(checked)
                  if (checked) setFormJson(false)
                }}
              />
              {t('send.hex')}
            </label>
            {!formHex && (
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={formJson}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setFormJson(checked)
                    if (checked) setFormText((prev) => prettyJson(prev))
                  }}
                />
                {t('quickCommands.jsonMode')}
              </label>
            )}
            {formJson && (
              <button type="button" onClick={() => setFormText((prev) => prettyJson(prev))}>
                {t('quickCommands.formatJson')}
              </button>
            )}
            <select
              title={t('quickCommands.lineEndingTitle')}
              value={formLineEnding}
              onChange={(e) => setFormLineEnding(e.target.value as LineEnding | '')}
            >
              <option value="">{t('quickCommands.lineEndingInherit')}</option>
              <option value="none">{t('common.none')}</option>
              <option value="cr">CR</option>
              <option value="lf">LF</option>
              <option value="crlf">CRLF</option>
            </select>
            <button
              type="button"
              onClick={submitForm}
              disabled={formText.trim().length === 0 || formHexInvalid || formJsonInvalid}
            >
              {editingId ? t('common.save') : t('common.add')}
            </button>
            <button type="button" onClick={resetForm}>
              {t('common.cancel')}
            </button>
          </div>
          {formJson && (
            <textarea
              className={`quick-command-json-textarea ${formJsonInvalid ? 'invalid' : ''}`}
              placeholder={t('quickCommands.jsonPlaceholder')}
              value={formText}
              onChange={(e) => setFormText(e.target.value)}
              onKeyDown={handleJsonKeyDown}
              rows={5}
              autoFocus
            />
          )}
          {formJsonInvalid && (
            <span className="quick-command-json-error">{t('quickCommands.invalidJson')}</span>
          )}
        </div>
      )}
    </>
  )
}
