import { save } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'
import { useTabsStore, type TabState, type TriggerActionType } from '../state/tabsStore'
import { useTriggerPresetsStore } from '../state/triggerPresetsStore'
import { FolderIcon, PlusIcon, TrashIcon } from './icons'
import { LibraryRow } from './LibraryRow'

const ACTION_TYPES: TriggerActionType[] = ['bookmark', 'send', 'sound', 'file', 'webhook']

export function TriggerBar({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const addTrigger = useTabsStore((s) => s.addTrigger)
  const removeTrigger = useTabsStore((s) => s.removeTrigger)
  const updateTrigger = useTabsStore((s) => s.updateTrigger)
  const toggleTriggerEnabled = useTabsStore((s) => s.toggleTriggerEnabled)
  const setTriggers = useTabsStore((s) => s.setTriggers)
  const presets = useTriggerPresetsStore((s) => s.items)
  const savePreset = useTriggerPresetsStore((s) => s.save)
  const deletePreset = useTriggerPresetsStore((s) => s.remove)

  const browseForFile = async (triggerId: string) => {
    const path = await save({ title: t('triggerBar.logFileDialogTitle') })
    if (path) updateTrigger(tab.id, triggerId, { action: { filePath: path } })
  }

  return (
    <div className="filter-bar">
      <LibraryRow
        label={t('filterBar.presetLabel')}
        items={presets}
        onLoad={(p) => setTriggers(tab.id, p.triggers)}
        onSave={(name) => savePreset(name, { triggers: tab.triggers })}
        onDelete={deletePreset}
      />
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
            placeholder={t('filterBar.regexPlaceholder')}
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
              <option key={a} value={a}>
                {t(`triggerBar.action.${a}`)}
              </option>
            ))}
          </select>

          {trigger.action.type === 'send' && (
            <>
              <input
                type="text"
                placeholder={t('triggerBar.sendPlaceholder')}
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
                {t('send.hex')}
              </label>
            </>
          )}

          {trigger.action.type === 'file' && (
            <>
              <input
                type="text"
                className="trigger-file-path"
                value={trigger.action.filePath}
                onChange={(e) =>
                  updateTrigger(tab.id, trigger.id, { action: { filePath: e.target.value } })
                }
              />
              <button
                type="button"
                className="icon-button"
                aria-label={t('triggerBar.chooseFile')}
                onClick={() => void browseForFile(trigger.id)}
              >
                <FolderIcon />
              </button>
            </>
          )}

          {trigger.action.type === 'webhook' && (
            <>
              <input
                type="text"
                className="trigger-webhook-url"
                placeholder={t('triggerBar.webhookUrlPlaceholder')}
                value={trigger.action.webhookUrl ?? ''}
                onChange={(e) =>
                  updateTrigger(tab.id, trigger.id, { action: { webhookUrl: e.target.value } })
                }
              />
              <input
                type="text"
                className="trigger-webhook-body"
                placeholder={t('triggerBar.webhookBodyPlaceholder')}
                title={t('triggerBar.webhookBodyTitle')}
                value={trigger.action.webhookBody ?? ''}
                onChange={(e) =>
                  updateTrigger(tab.id, trigger.id, { action: { webhookBody: e.target.value } })
                }
              />
            </>
          )}

          <button
            type="button"
            className="icon-button"
            aria-label={t('triggerBar.removeTrigger')}
            onClick={() => removeTrigger(tab.id, trigger.id)}
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      <div className="filter-actions">
        <button type="button" onClick={() => addTrigger(tab.id)}>
          <PlusIcon /> {t('triggerBar.addTrigger')}
        </button>
      </div>
    </div>
  )
}
