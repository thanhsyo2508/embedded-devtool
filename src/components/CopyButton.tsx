import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon, CopyIcon } from './icons'

const FEEDBACK_MS = 1500

/** Copy-to-clipboard icon button shared by every "copy" spot in the app —
 * swaps to a checkmark for a beat after a successful copy so clicking it
 * actually confirms something happened, instead of looking like a no-op.
 * `writeText` defaults to the Web clipboard API; pass the Tauri
 * clipboard-manager plugin's `writeText` instead where a caller already
 * relied on that (e.g. FtpPanel) — this component only adds the feedback
 * state, not a change of which clipboard API gets used. */
export function CopyButton({
  getText,
  writeText = (text) => navigator.clipboard.writeText(text),
  className = '',
  title,
  ariaLabel,
}: {
  getText: () => string
  writeText?: (text: string) => Promise<void>
  className?: string
  title?: string
  ariaLabel?: string
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timeoutRef.current), [])

  const handleClick = () => {
    writeText(getText())
      .then(() => {
        setCopied(true)
        clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => setCopied(false), FEEDBACK_MS)
      })
      .catch(() => {})
  }

  const label = copied ? t('common.copied') : (title ?? ariaLabel ?? t('common.copy'))

  return (
    <button
      type="button"
      className={`icon-button copy-button ${copied ? 'copied' : ''} ${className}`.trim()}
      title={label}
      aria-label={label}
      onClick={handleClick}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}
