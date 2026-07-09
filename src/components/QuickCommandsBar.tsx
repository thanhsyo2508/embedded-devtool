import { useState } from 'react'
import { useTabsStore, type TabState } from '../state/tabsStore'
import { useQuickCommandProfilesStore, type QuickCommand } from '../state/quickCommandProfilesStore'
import { parseHex } from '../lib/hex'
import { PlusIcon, TrashIcon } from './icons'

function newCommandId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// A single always-visible, single-row strip (not a togglable side panel like
// Filters/Triggers) — the point of a "quick" command is one click to fire
// it, so it stays in view. Kept to one compact row (horizontally scrolling,
// not wrapping) so it doesn't eat vertical space the way a full editable
// list (à la FilterBar) would once a profile has more than a few commands.
export function QuickCommandsBar({ tab }: { tab: TabState }) {
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
  const [dragId, setDragId] = useState<string | null>(null)

  const profile = profiles.find((p) => p.id === tab.quickCommandProfileId) ?? null
  const formHexInvalid = formHex && parseHex(formText) === null

  const runCommand = (cmd: QuickCommand) => {
    if (tab.status !== 'open') return
    if (cmd.isHex) {
      const bytes = parseHex(cmd.text)
      if (bytes && bytes.length > 0) void sendBytes(tab.id, bytes, cmd.text, true)
    } else if (cmd.text.length > 0) {
      void send(tab.id, cmd.text)
    }
  }

  const persistCommands = (commands: QuickCommand[]) => {
    if (!profile) return
    saveProfile(profile.name, { commands })
  }

  const handleNewProfile = () => {
    const name = window.prompt('Quick command profile name?')
    if (!name) return
    saveProfile(name, { commands: [] })
    const created = useQuickCommandProfilesStore.getState().items.find((p) => p.name === name)
    if (created) setQuickCommandProfile(tab.id, created.id)
  }

  const handleDeleteProfile = () => {
    if (!profile) return
    if (!window.confirm(`Delete quick command profile "${profile.name}"?`)) return
    deleteProfile(profile.id)
    setQuickCommandProfile(tab.id, null)
  }

  const resetForm = () => {
    setAdding(false)
    setEditingId(null)
    setFormLabel('')
    setFormText('')
    setFormHex(false)
  }

  const startEdit = (cmd: QuickCommand) => {
    setAdding(false)
    setEditingId(cmd.id)
    setFormLabel(cmd.label)
    setFormText(cmd.text)
    setFormHex(cmd.isHex)
  }

  const submitForm = () => {
    if (!profile || formText.trim().length === 0 || formHexInvalid) return
    if (editingId) {
      persistCommands(
        profile.commands.map((c) =>
          c.id === editingId
            ? { ...c, label: formLabel.trim(), text: formText, isHex: formHex }
            : c,
        ),
      )
    } else {
      const cmd: QuickCommand = {
        id: newCommandId(),
        label: formLabel.trim(),
        text: formText,
        isHex: formHex,
      }
      persistCommands([...profile.commands, cmd])
    }
    resetForm()
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
      <div className="quick-commands-bar">
        <select
          className="quick-command-profile-select"
          value={profile?.id ?? ''}
          onChange={(e) => setQuickCommandProfile(tab.id, e.target.value || null)}
        >
          <option value="">Quick commands…</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-button"
          aria-label="New quick command profile"
          title="New profile"
          onClick={handleNewProfile}
        >
          <PlusIcon />
        </button>
        {profile && (
          <button
            type="button"
            className="icon-button"
            aria-label="Delete quick command profile"
            title={`Delete profile "${profile.name}"`}
            onClick={handleDeleteProfile}
          >
            <TrashIcon />
          </button>
        )}
        {profile && (
          <div className="quick-command-chips">
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
                <button
                  type="button"
                  className="quick-command-edit"
                  aria-label="Edit command"
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
                  aria-label="Remove command"
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
              <PlusIcon /> Add
            </button>
          </div>
        )}
      </div>
      {(adding || editingId) && profile && (
        <div className="quick-command-form">
          <input
            type="text"
            placeholder="Label (optional)"
            value={formLabel}
            onChange={(e) => setFormLabel(e.target.value)}
          />
          <input
            type="text"
            className={formHexInvalid ? 'invalid' : ''}
            placeholder={formHex ? 'e.g. 01 02 FF' : 'Command text'}
            value={formText}
            onChange={(e) => setFormText(e.target.value)}
          />
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={formHex}
              onChange={(e) => setFormHex(e.target.checked)}
            />
            hex
          </label>
          <button
            type="button"
            onClick={submitForm}
            disabled={formText.trim().length === 0 || formHexInvalid}
          >
            {editingId ? 'Save' : 'Add'}
          </button>
          <button type="button" onClick={resetForm}>
            Cancel
          </button>
        </div>
      )}
    </>
  )
}
