import { useTranslation } from 'react-i18next'
import { useTabsStore, type TabState } from '../state/tabsStore'
import { usePluginLibraryStore } from '../state/pluginLibraryStore'

export function PluginBar({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const plugins = usePluginLibraryStore((s) => s.items)
  const togglePlugin = useTabsStore((s) => s.togglePlugin)

  if (plugins.length === 0) {
    return (
      <div className="filter-bar">
        <p className="plugin-bar-empty">{t('pluginBar.noneInstalled')}</p>
      </div>
    )
  }

  return (
    <div className="filter-bar plugin-bar">
      {plugins.map((plugin) => {
        const active = tab.activePlugins.find((p) => p.pluginId === plugin.id)
        return (
          <div key={plugin.id} className="plugin-bar-entry">
            <div className="filter-row">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={active?.running ?? false}
                  onChange={() => void togglePlugin(tab.id, plugin)}
                />
              </label>
              <span className="plugin-bar-name">{plugin.name}</span>
              <span className="plugin-bar-kind">{t(`pluginBar.kind.${plugin.kind}`)}</span>
            </div>
            {active?.error && <p className="connect-error plugin-bar-error">{active.error}</p>}
            {active?.running && plugin.kind === 'decoder' && (
              <table className="plugin-bar-fields">
                <tbody>
                  {Object.keys(active.fields).length === 0 ? (
                    <tr>
                      <td colSpan={2} className="plugin-bar-fields-empty">
                        {t('pluginBar.waitingForData')}
                      </td>
                    </tr>
                  ) : (
                    Object.entries(active.fields).map(([key, value]) => (
                      <tr key={key}>
                        <td className="mono">{key}</td>
                        <td className="mono">{value}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}
