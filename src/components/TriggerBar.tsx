import { save } from '@tauri-apps/plugin-dialog'
import { useTabsStore, type TabState, type TriggerActionType } from '../state/tabsStore'
import { FolderIcon, PlusIcon, TrashIcon } from './icons'

const ACTION_TYPES: { value: TriggerActionType; label: string }[] = [
  { value: 'bookmark', label: 'Bookmark line' },
  { value: 'send', label: 'Send' },
  { value: 'sound', label: 'Play sound' },
  { value: 'file', label: 'Write to file' },
]

export function TriggerBar({ tab }: { tab: TabState }) {
  const addTrigger = useTabsStore((s) => s.addTrigger)
  const removeTrigger = useTabsStore((s) => s.removeTrigger)
  const updateTrigger = useTabsStore((s) => s.updateTrigger)
  const toggleTriggerEnabled = useTabsStore((s) => s.toggleTriggerEnabled)

  const browseForFile = async (triggerId: string) => {
    const path = await save({ title: 'Trigger log file' })
    if (path) updateTrigger(tab.id, triggerId, { action: { filePath: path } })
  }

  return (
    <div className="filter-bar">
      {tab.triggers.map((trigger) => (
        <div className="filter-row trigger-row" key={trigger.id}>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={trigger.enabled}
              onChange={() => toggleTriggerEnabled(tab.id, trigger.id)}
            />
          </label>
          <input
            type="text"
            placeholder="regex pattern"
            value={trigger.pattern}
            onChange={(e) => updateTrigger(tab.id, trigger.id, { pattern: e.target.value })}
          />
          <select
            value={trigger.action.type}
            onChange={(e) =>
              updateTrigger(tab.id, trigger.id, {
                action: { type: e.target.value as TriggerActionType },
              })
            }
          >
            {ACTION_TYPES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>

          {trigger.action.type === 'send' && (
            <>
              <input
                type="text"
                placeholder="text/hex to send"
                value={trigger.action.sendText}
                onChange={(e) =>
                  updateTrigger(tab.id, trigger.id, { action: { sendText: e.target.value } })
                }
              />
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={trigger.action.sendIsHex}
                  onChange={(e) =>
                    updateTrigger(tab.id, trigger.id, {
                      action: { sendIsHex: e.target.checked },
                    })
                  }
                />
                hex
              </label>
            </>
          )}

          {trigger.action.type === 'file' && (
            <>
              <input
                type="text"
                className="trigger-file-path"
                value={trigger.action.filePath}
                readOnly
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Choose file"
                onClick={() => void browseForFile(trigger.id)}
              >
                <FolderIcon />
              </button>
            </>
          )}

          <button
            type="button"
            className="icon-button"
            aria-label="Remove trigger"
            onClick={() => removeTrigger(tab.id, trigger.id)}
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      <div className="filter-actions">
        <button type="button" onClick={() => addTrigger(tab.id)}>
          <PlusIcon /> Add trigger
        </button>
      </div>
    </div>
  )
}
