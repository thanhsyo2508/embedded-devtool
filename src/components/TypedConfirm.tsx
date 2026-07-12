import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/** A button that only becomes clickable after the user types an exact
 * keyword into an inline field — for actions that are genuinely
 * irreversible (burning an eFuse, permanently locking a chip's debug
 * access) where a plain yes/no confirm() is too easy to click through
 * without reading. */
export function TypedConfirm({
  keyword,
  label,
  disabled,
  onConfirm,
}: {
  keyword: string
  label: string
  disabled?: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')

  if (!open) {
    return (
      <button
        type="button"
        className="flash-erase"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="typed-confirm">
      <span className="typed-confirm-hint">{t('common.typeToConfirm', { keyword })}</span>
      <input
        className="mono"
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        placeholder={keyword}
      />
      <button
        type="button"
        className="flash-erase"
        disabled={text !== keyword}
        onClick={() => {
          onConfirm()
          setOpen(false)
          setText('')
        }}
      >
        {label}
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={() => {
          setOpen(false)
          setText('')
        }}
      >
        {t('common.cancel')}
      </button>
    </div>
  )
}
