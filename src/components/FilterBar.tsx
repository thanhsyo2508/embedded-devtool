import { useMemo } from 'react'
import { useTabsStore, type TabState } from '../state/tabsStore'
import { compileFilter } from '../lib/filterLines'
import { PlusIcon, TrashIcon } from './icons'

export function FilterBar({ tab, visibleCount }: { tab: TabState; visibleCount: number }) {
  const addFilter = useTabsStore((s) => s.addFilter)
  const removeFilter = useTabsStore((s) => s.removeFilter)
  const updateFilterPattern = useTabsStore((s) => s.updateFilterPattern)
  const toggleFilterEnabled = useTabsStore((s) => s.toggleFilterEnabled)

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
            <span className={`mode-tag ${filter.mode}`}>{filter.mode}</span>
            <input
              type="text"
              className={invalid ? 'invalid' : ''}
              value={filter.pattern}
              placeholder="regex pattern"
              onChange={(e) => updateFilterPattern(tab.id, filter.id, e.target.value)}
            />
            {filter.enabled && !invalid && (
              <span className="filter-count">{matchCounts[filter.id] ?? 0}</span>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="Remove filter"
              onClick={() => removeFilter(tab.id, filter.id)}
            >
              <TrashIcon />
            </button>
          </div>
        )
      })}
      <div className="filter-actions">
        <button type="button" onClick={() => addFilter(tab.id, 'include')}>
          <PlusIcon /> Include
        </button>
        <button type="button" onClick={() => addFilter(tab.id, 'exclude')}>
          <PlusIcon /> Exclude
        </button>
        <span className="line-count">
          {visibleCount.toLocaleString()} / {tab.lines.length.toLocaleString()} lines
        </span>
      </div>
    </div>
  )
}
