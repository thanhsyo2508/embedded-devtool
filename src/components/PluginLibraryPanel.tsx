import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'
import { usePluginLibraryStore } from '../state/pluginLibraryStore'
import { parsePlugin } from '../lib/pluginManifest'
import { fetchPluginFromUrl } from '../api/plugin'
import { FolderIcon, GlobeIcon, PuzzleIcon, TrashIcon, XIcon } from './icons'

/** Install/manage plugins (custom protocol decoders and plotter parsers) —
 * a global library, not a tab; attaching an installed plugin to a
 * particular connection happens from that tab's monitor toolbar (see
 * PluginBar), the same "global library, per-tab activation" split the
 * script library and quick-command profiles already use. */
export function PluginLibraryPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const plugins = usePluginLibraryStore((s) => s.items)
  const savePlugin = usePluginLibraryStore((s) => s.save)
  const removePlugin = usePluginLibraryStore((s) => s.remove)
  const [urlValue, setUrlValue] = useState('')
  const [urlBusy, setUrlBusy] = useState(false)

  const installFromSource = (source: string) => {
    const { manifest, code } = parsePlugin(source)
    savePlugin(manifest.name, {
      version: manifest.version,
      description: manifest.description,
      kind: manifest.kind,
      code,
    })
  }

  const handleInstall = async () => {
    const picked = await open({
      title: t('pluginLibrary.installDialogTitle'),
      filters: [{ name: t('pluginLibrary.luaFilterName'), extensions: ['lua'] }],
    })
    if (typeof picked !== 'string') return
    try {
      const source = await invoke<string>('read_text_file', { path: picked })
      installFromSource(source)
    } catch (err) {
      window.alert(String(err))
    }
  }

  const handleInstallFromUrl = async () => {
    const url = urlValue.trim()
    if (!url) return
    setUrlBusy(true)
    try {
      const source = await fetchPluginFromUrl(url)
      installFromSource(source)
      setUrlValue('')
    } catch (err) {
      window.alert(String(err))
    } finally {
      setUrlBusy(false)
    }
  }

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(t('pluginLibrary.deleteConfirm', { name }))) {
      removePlugin(id)
    }
  }

  return (
    <div className="settings-overlay netscan-overlay" onClick={onClose}>
      <div className="netscan-panel plugin-library-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">
            <PuzzleIcon /> {t('pluginLibrary.title')}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <XIcon />
          </button>
        </div>

        <p className="ota-hint">{t('pluginLibrary.hint')}</p>

        <div className="flash-actions">
          <button
            type="button"
            className="connect-button flash-go"
            onClick={() => void handleInstall()}
          >
            <FolderIcon /> {t('pluginLibrary.install')}
          </button>
        </div>

        <div className="plugin-library-url-row">
          <GlobeIcon />
          <input
            type="text"
            value={urlValue}
            placeholder={t('pluginLibrary.installUrlPlaceholder')}
            disabled={urlBusy}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleInstallFromUrl()
            }}
          />
          <button
            type="button"
            className="icon-button"
            title={t('pluginLibrary.installFromUrl')}
            disabled={urlBusy || !urlValue.trim()}
            onClick={() => void handleInstallFromUrl()}
          >
            {urlBusy ? '…' : t('pluginLibrary.installFromUrl')}
          </button>
        </div>

        <div className="plugin-library-list">
          {plugins.length === 0 && (
            <p className="plugin-bar-empty">{t('pluginLibrary.noneInstalled')}</p>
          )}
          {plugins.map((plugin) => (
            <div key={plugin.id} className="plugin-library-row">
              <div className="plugin-library-row-main">
                <span className="plugin-library-row-name">{plugin.name}</span>
                <span className="plugin-bar-kind">{t(`pluginBar.kind.${plugin.kind}`)}</span>
                {plugin.version && <span className="mono">v{plugin.version}</span>}
              </div>
              {plugin.description && (
                <p className="plugin-library-row-description">{plugin.description}</p>
              )}
              <button
                type="button"
                className="icon-button"
                title={t('common.delete')}
                onClick={() => handleDelete(plugin.id, plugin.name)}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
