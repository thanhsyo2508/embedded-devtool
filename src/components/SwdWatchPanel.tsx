import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'
import type { TabState } from '../state/tabsStore'
import { useSwdWatchStore } from '../state/swdWatchStore'
import { decodeSwdValue } from '../lib/swdValue'
import { FolderIcon, PlusIcon, TrashIcon } from './icons'

/** Variable watch for an RTT/SWD tab — lets you pick global/static
 * variables out of a build's `.elf` (parsed via DWARF, see
 * swd::variables) and see their live value, polled over the same SWD
 * session the tab's RTT log already uses. Rendered instead of the usual
 * Send box for `rtt` tabs (see TabContent) since RTT down-channel writes
 * aren't supported. */
export function SwdWatchPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const wireEventsOnce = useSwdWatchStore((s) => s.wireEventsOnce)
  const loadElf = useSwdWatchStore((s) => s.loadElf)
  const addWatch = useSwdWatchStore((s) => s.addWatch)
  const removeWatch = useSwdWatchStore((s) => s.removeWatch)
  const available = useSwdWatchStore((s) => s.availableByTab[tab.id] ?? [])
  const watches = useSwdWatchStore((s) => s.watchesByTab[tab.id] ?? [])
  const [elfPath, setElfPath] = useState<string | null>(null)
  const [elfError, setElfError] = useState<string | null>(null)
  const [selected, setSelected] = useState('')

  useEffect(() => {
    wireEventsOnce()
  }, [wireEventsOnce])

  const browseForElf = async () => {
    const picked = await open({ filters: [{ name: 'ELF', extensions: ['elf', 'out', ''] }] })
    if (typeof picked !== 'string') return
    setElfError(null)
    try {
      await loadElf(tab.id, picked)
      setElfPath(picked)
    } catch (err) {
      setElfError(String(err))
    }
  }

  const watchedNames = new Set(watches.map((w) => w.name))
  const addableVariables = available.filter((v) => !watchedNames.has(v.name))

  const handleAdd = () => {
    const variable = available.find((v) => v.name === selected)
    if (!variable) return
    void addWatch(tab.id, variable)
    setSelected('')
  }

  return (
    <div className="swd-watch-panel">
      <div className="field-row">
        <button type="button" onClick={() => void browseForElf()}>
          <FolderIcon /> {t('swdWatch.loadElf')}
        </button>
        {elfPath && <span className="mono swd-watch-elf-path">{elfPath}</span>}
      </div>
      {elfError && <p className="connect-error">{elfError}</p>}

      {available.length > 0 && (
        <div className="field-row">
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">{t('swdWatch.selectVariable')}</option>
            {addableVariables.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.typeHint})
              </option>
            ))}
          </select>
          <button type="button" disabled={!selected} onClick={handleAdd}>
            <PlusIcon /> {t('common.add')}
          </button>
        </div>
      )}

      <div className="debug-table-wrap">
        <table className="debug-table">
          <thead>
            <tr>
              <th>{t('swdWatch.name')}</th>
              <th>{t('swdWatch.value')}</th>
              <th>{t('swdWatch.type')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {watches.length === 0 && (
              <tr>
                <td colSpan={4} className="netscan-empty">
                  {t('swdWatch.empty')}
                </td>
              </tr>
            )}
            {watches.map((w) => (
              <tr key={w.name}>
                <td className="mono">{w.name}</td>
                <td className="mono">{decodeSwdValue(w.typeHint, w.bytes)}</td>
                <td className="mono">{w.typeHint}</td>
                <td>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('swdWatch.remove')}
                    title={t('swdWatch.remove')}
                    onClick={() => void removeWatch(tab.id, w.name)}
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
