import { useState } from 'react'
import type { DropZone, PaneNode } from '../lib/layoutTree'
import { useLayoutStore } from '../state/layoutStore'
import { useTabsStore } from '../state/tabsStore'
import { TabContent } from './TabContent'
import { TabStrip } from './TabStrip'

function zoneFromPointer(e: React.DragEvent<HTMLDivElement>): DropZone {
  const rect = e.currentTarget.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width
  const y = (e.clientY - rect.top) / rect.height
  if (x < 0.25) return 'left'
  if (x > 0.75) return 'right'
  if (y < 0.25) return 'top'
  if (y > 0.75) return 'bottom'
  return 'center'
}

export function PaneContent({ pane, onAddClick }: { pane: PaneNode; onAddClick: () => void }) {
  const allTabs = useTabsStore((s) => s.tabs)
  const closeTab = useTabsStore((s) => s.closeTab)
  const focusedPaneId = useLayoutStore((s) => s.focusedPaneId)
  const focusPane = useLayoutStore((s) => s.focusPane)
  const layoutCloseTab = useLayoutStore((s) => s.closeTab)
  const splitPaneWithTab = useLayoutStore((s) => s.splitPaneWithTab)
  const [dropZone, setDropZone] = useState<DropZone | null>(null)

  const activeTab = allTabs.find((t) => t.id === pane.activeTabId) ?? null
  const isFocused = pane.id === focusedPaneId

  const handleCloseTab = (tabId: string) => {
    void closeTab(tabId)
    layoutCloseTab(tabId)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDropZone(zoneFromPointer(e))
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const tabId = e.dataTransfer.getData('text/plain')
    const zone = dropZone
    setDropZone(null)
    if (!tabId || !zone) return
    splitPaneWithTab(pane.id, tabId, zone)
  }

  // dragleave bubbles from every child the pointer crosses (xterm/uPlot
  // canvases, MonitorView rows, ...) on its way across the pane, not just
  // when it actually exits pane-body — only clear the overlay once the
  // pointer has left the element for good (relatedTarget outside it).
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDropZone(null)
  }

  return (
    <div className={`pane ${isFocused ? 'focused' : ''}`} onMouseDown={() => focusPane(pane.id)}>
      <TabStrip pane={pane} onAddClick={onAddClick} onCloseTab={handleCloseTab} />
      <div
        className="pane-body"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {activeTab ? <TabContent tab={activeTab} /> : <div className="pane-empty">No tab open</div>}
        {dropZone && <div className={`drop-zone-overlay zone-${dropZone}`} />}
      </div>
    </div>
  )
}
