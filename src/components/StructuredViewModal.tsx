import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { prettyStructured } from '../lib/prettyStructured'
import { tokenizeJson } from '../lib/jsonHighlight'
import { XIcon } from './icons'
import { CopyButton } from './CopyButton'

/** Shows a monitor selection pretty-printed — JSON with syntax highlighting,
 * CSV/TSV column-aligned — from the right-click "Format JSON/CSV" action. */
export function StructuredViewModal({ text, onClose }: { text: string; onClose: () => void }) {
  const { t } = useTranslation()
  const result = useMemo(() => prettyStructured(text), [text])
  const jsonTokens = useMemo(
    () => (result.kind === 'json' ? tokenizeJson(result.formatted) : null),
    [result],
  )

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="structured-view" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">{t(`structured.${result.kind}`)}</span>
          <div className="structured-view-actions">
            <CopyButton getText={() => result.formatted} />
            <button
              type="button"
              className="icon-button"
              aria-label={t('common.close')}
              onClick={onClose}
            >
              <XIcon />
            </button>
          </div>
        </div>
        <pre className="structured-view-body mono">
          {jsonTokens
            ? jsonTokens.map((tok, i) =>
                tok.kind ? (
                  <span key={i} className={`json-${tok.kind}`}>
                    {tok.text}
                  </span>
                ) : (
                  <span key={i}>{tok.text}</span>
                ),
              )
            : result.formatted}
        </pre>
      </div>
    </div>
  )
}
