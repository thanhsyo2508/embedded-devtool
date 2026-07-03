import { useRef } from 'react'
import { usePlotStore } from '../state/plotStore'

/** Drag handle between the monitor and the plotter dock below it. */
export function WorkspaceResizer() {
  const dockHeight = usePlotStore((s) => s.dockHeight)
  const setDockHeight = usePlotStore((s) => s.setDockHeight)
  const dragStart = useRef<{ y: number; height: number } | null>(null)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = { y: e.clientY, height: dockHeight }

    const handleMove = (moveEvent: PointerEvent) => {
      if (!dragStart.current) return
      const delta = dragStart.current.y - moveEvent.clientY
      setDockHeight(dragStart.current.height + delta)
    }
    const handleUp = () => {
      dragStart.current = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  return <div className="workspace-resizer" onPointerDown={handlePointerDown} />
}
