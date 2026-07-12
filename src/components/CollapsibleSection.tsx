import { useState, type ReactNode } from 'react'
import { ChevronDownIcon } from './icons'

/** A section that starts collapsed (by default) behind a clickable header —
 * used for panels that have grown too many always-visible blocks (STM32's
 * flash tab: interface/detect, Security, advanced option bytes, log) to fit
 * comfortably in the fixed-width flash panel at once. */
export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="collapsible-section">
      <div
        className="collapsible-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen((o) => !o)
          }
        }}
      >
        <span className="collapsible-title">{title}</span>
        <ChevronDownIcon className={`collapsible-chevron${open ? ' open' : ''}`} />
      </div>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  )
}
