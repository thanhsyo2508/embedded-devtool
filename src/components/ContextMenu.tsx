import { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  disabled?: boolean
  /** Inserts a divider above this item — for grouping (e.g. "Copy" apart
   * from the quick actions that jump elsewhere in the app). */
  separatorBefore?: boolean
}

/** Generic right-click menu, positioned at the click point and clamped to
 * stay on-screen. Closes on an outside click, Escape, or picking an item —
 * callers own what "open" means (a piece of local state holding the click
 * position + captured text), this only renders and dispatches. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  // Clamps into the viewport so a right-click near the right/bottom edge
  // doesn't render a menu partially off-screen.
  const style = {
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - items.length * 30 - 16),
  }

  return (
    <div className="context-menu" style={style} ref={menuRef}>
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          className={`context-menu-item ${item.separatorBefore ? 'context-menu-separator' : ''}`}
          disabled={item.disabled}
          onClick={() => {
            item.onClick()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
