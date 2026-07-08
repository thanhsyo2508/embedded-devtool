import { useRef } from 'react'
import { useLayoutStore } from '../state/layoutStore'
import type { SplitDirection } from '../lib/layoutTree'

const MIN_SIZE_RATIO = 0.1

// Sits as a DOM sibling directly between the two pane-split-item elements
// it resizes (see PaneView), so it can read their live pixel size straight
// off previousElementSibling/nextElementSibling instead of needing refs
// threaded down from the parent — same drag-then-window-listener shape as
// WorkspaceResizer, generalized to arbitrary sibling panes.
export function SplitResizer({
  splitId,
  index,
  direction,
  sizeA,
  sizeB,
}: {
  splitId: string
  index: number
  direction: SplitDirection
  sizeA: number
  sizeB: number
}) {
  const resizeSplit = useLayoutStore((s) => s.resizeSplit)
  const dragStart = useRef<{ pos: number; pxA: number; pxB: number } | null>(null)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = e.currentTarget.previousElementSibling as HTMLElement | null
    const next = e.currentTarget.nextElementSibling as HTMLElement | null
    if (!prev || !next) return
    const prevRect = prev.getBoundingClientRect()
    const nextRect = next.getBoundingClientRect()
    dragStart.current = {
      pos: direction === 'row' ? e.clientX : e.clientY,
      pxA: direction === 'row' ? prevRect.width : prevRect.height,
      pxB: direction === 'row' ? nextRect.width : nextRect.height,
    }

    const handleMove = (moveEvent: PointerEvent) => {
      if (!dragStart.current) return
      const totalPx = dragStart.current.pxA + dragStart.current.pxB
      if (totalPx <= 0) return
      const pos = direction === 'row' ? moveEvent.clientX : moveEvent.clientY
      const deltaPx = pos - dragStart.current.pos
      const totalWeight = sizeA + sizeB
      let ratioA = (dragStart.current.pxA + deltaPx) / totalPx
      ratioA = Math.min(1 - MIN_SIZE_RATIO, Math.max(MIN_SIZE_RATIO, ratioA))
      const newSizeA = totalWeight * ratioA
      resizeSplit(splitId, index, newSizeA, totalWeight - newSizeA)
    }
    const handleUp = () => {
      dragStart.current = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  return (
    <div className={`pane-resizer pane-resizer-${direction}`} onPointerDown={handlePointerDown} />
  )
}
