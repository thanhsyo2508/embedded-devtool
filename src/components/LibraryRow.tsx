import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DiskIcon, TrashIcon } from './icons'
import type { LibraryItem } from '../state/createLibraryStore'

/** Load/save/delete row shared by connection profiles, the script library,
 * and filter/trigger presets — same interaction in all four places: pick a
 * saved item to apply it, Save prompts a name (overwriting on reuse), Delete
 * removes whatever's selected. */
export function LibraryRow<T extends LibraryItem>({
  label,
  items,
  onLoad,
  onSave,
  onDelete,
}: {
  label: string
  items: T[]
  onLoad: (item: T) => void
  onSave: (name: string) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = useState('')

  const handleLoad = (id: string) => {
    setSelectedId(id)
    const item = items.find((i) => i.id === id)
    if (item) onLoad(item)
  }

  const handleSave = () => {
    const current = items.find((i) => i.id === selectedId)
    const name = window.prompt(t('library.namePrompt', { label }), current?.name ?? '')
    if (name) onSave(name)
  }

  const handleDelete = () => {
    if (!selectedId) return
    const current = items.find((i) => i.id === selectedId)
    if (
      !window.confirm(
        t('library.deleteConfirm', { label: label.toLowerCase(), name: current?.name ?? '' }),
      )
    )
      return
    onDelete(selectedId)
    setSelectedId('')
  }

  return (
    <div className="library-row">
      <select value={selectedId} onChange={(e) => handleLoad(e.target.value)}>
        <option value="">{label}…</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="icon-button"
        aria-label={t('library.save', { label })}
        title={t('library.save', { label })}
        onClick={handleSave}
      >
        <DiskIcon />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={t('library.delete', { label })}
        title={t('library.delete', { label })}
        disabled={!selectedId}
        onClick={handleDelete}
      >
        <TrashIcon />
      </button>
    </div>
  )
}
