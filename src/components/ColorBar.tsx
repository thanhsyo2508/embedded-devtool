import { useTranslation } from 'react-i18next'
import { useTabsStore, type TabState } from '../state/tabsStore'
import { PlusIcon, TrashIcon } from './icons'

/** Validates a rule's pattern the same way the compiler does, so a bad
 * regex gets the `invalid` outline while typing — matches FilterBar. */
function isInvalid(pattern: string): boolean {
  if (pattern.length === 0) return false
  try {
    new RegExp(pattern)
    return false
  } catch {
    return true
  }
}

export function ColorBar({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const addColorRule = useTabsStore((s) => s.addColorRule)
  const removeColorRule = useTabsStore((s) => s.removeColorRule)
  const updateColorRule = useTabsStore((s) => s.updateColorRule)
  const toggleColorRuleEnabled = useTabsStore((s) => s.toggleColorRuleEnabled)

  return (
    <div className="filter-bar">
      <p className="ota-hint">{t('colorBar.hint')}</p>
      {tab.colorRules.map((rule) => (
        <div className="filter-row" key={rule.id}>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={() => toggleColorRuleEnabled(tab.id, rule.id)}
            />
          </label>
          <input
            type="color"
            className="color-rule-swatch"
            value={rule.color}
            title={t('colorBar.pickColor')}
            onChange={(e) => updateColorRule(tab.id, rule.id, { color: e.target.value })}
          />
          <input
            type="text"
            className={isInvalid(rule.pattern) ? 'invalid' : ''}
            value={rule.pattern}
            placeholder={t('filterBar.regexPlaceholder')}
            onChange={(e) => updateColorRule(tab.id, rule.id, { pattern: e.target.value })}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={t('colorBar.removeRule')}
            onClick={() => removeColorRule(tab.id, rule.id)}
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      <div className="filter-actions">
        <button type="button" onClick={() => addColorRule(tab.id)}>
          <PlusIcon /> {t('colorBar.addRule')}
        </button>
      </div>
    </div>
  )
}
