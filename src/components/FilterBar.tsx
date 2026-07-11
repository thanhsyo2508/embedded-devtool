import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useTabsStore, type TabState } from '../state/tabsStore'
import { useFilterPresetsStore } from '../state/filterPresetsStore'
import { compileFilter } from '../lib/filterLines'
import { PlusIcon, TrashIcon } from './icons'
import { LibraryRow } from './LibraryRow'

export function FilterBar({ tab, visibleCount }: { tab: TabState; visibleCount: number }) {
  const { t } = useTranslation()
  const addFilter = useTabsStore((s) => s.addFilter)
  const removeFilter = useTabsStore((s) => s.removeFilter)
  const updateFilterPattern = useTabsStore((s) => s.updateFilterPattern)
  const toggleFilterEnabled = useTabsStore((s) => s.toggleFilterEnabled)
  const setFilters = useTabsStore((s) => s.setFilters)
  const presets = useFilterPresetsStore((s) => s.items)
  const savePreset = useFilterPresetsStore((s) => s.save)
  const deletePreset = useFilterPresetsStore((s) => s.remove)

  const matchCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const filter of tab.filters) {
      const re = compileFilter(filter)
      counts[filter.id] = re ? tab.lines.filter((l) => re.test(l.text)).length : 0
    }
    return counts
  }, [tab.filters, tab.lines])

  return (
    <div className="filter-bar">
      <LibraryRow
        label={t('filterBar.presetLabel')}
        items={presets}
        onLoad={(p) => setFilters(tab.id, p.filters)}
        onSave={(name) => savePreset(name, { filters: tab.filters })}
        onDelete={deletePreset}
      />
      {tab.filters.map((filter) => {
        const invalid =
          filter.pattern.length > 0 && compileFilter({ ...filter, enabled: true }) === null
        return (
          <div className="filter-row" key={filter.id}>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={filter.enabled}
                onChange={() => toggleFilterEnabled(tab.id, filter.id)}
              />
            </label>
            <span className={`mode-tag ${filter.mode}`}>{t(`filterBar.mode.${filter.mode}`)}</span>
            <input
              type="text"
              className={invalid ? 'invalid' : ''}
              value={filter.pattern}
              placeholder={t('filterBar.regexPlaceholder')}
              onChange={(e) => updateFilterPattern(tab.id, filter.id, e.target.value)}
            />
            {filter.enabled && !invalid && (
              <span className="filter-count">{matchCounts[filter.id] ?? 0}</span>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label={t('filterBar.removeFilter')}
              onClick={() => removeFilter(tab.id, filter.id)}
            >
              <TrashIcon />
            </button>
          </div>
        )
      })}
      <div className="filter-actions">
        <button type="button" onClick={() => addFilter(tab.id, 'include')}>
          <PlusIcon /> {t('filterBar.include')}
        </button>
        <button type="button" onClick={() => addFilter(tab.id, 'exclude')}>
          <PlusIcon /> {t('filterBar.exclude')}
        </button>
        <span className="line-count">
          {t('filterBar.lineCount', {
            visible: visibleCount.toLocaleString(),
            total: tab.lines.length.toLocaleString(),
          })}
        </span>
      </div>
    </div>
  )
}
