import { useState } from 'react'
import type { PaneNode } from '../lib/layoutTree'
import { useLayoutStore } from '../state/layoutStore'
import { useTabsStore } from '../state/tabsStore'

// Per-pane tab strip: reads only its own pane's tabIds (not the global tab
// list) so multiple panes can each show a different subset of open tabs.
// Tabs are made native HTML5 drag sources here; PaneContent's content area
// is the drop target for creating a new split, and this strip is itself a
// drop target for the far more common "merge this tab back into that
// pane" gesture (dropping directly among another pane's tabs).
export function TabStrip({
  pane,
  onAddClick,
  onCloseTab,
}: {
  pane: PaneNode
  onAddClick: () => void
  onCloseTab: (tabId: string) => void
}) {
  const allTabs = useTabsStore((s) => s.tabs)
  const setActiveTabInPane = useLayoutStore((s) => s.setActiveTabInPane)
  const focusPane = useLayoutStore((s) => s.focusPane)
  const moveTabToPane = useLayoutStore((s) => s.moveTabToPane)
  const [dragOver, setDragOver] = useState(false)

  const tabs = pane.tabIds
    .map((id) => allTabs.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => !!t)

  return (
    <div
      className={`tab-strip ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const tabId = e.dataTransfer.getData('text/plain')
        if (tabId) moveTabToPane(tabId, pane.id)
      }}
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${tab.id === pane.activeTabId ? 'active' : ''}`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', tab.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onClick={() => setActiveTabInPane(pane.id, tab.id)}
        >
          <span className={`status-dot ${tab.status}`} />
          <span className="tab-label">{tab.connectionLabel}</span>
          <button
            type="button"
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              onCloseTab(tab.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="tab-add"
        onClick={() => {
          focusPane(pane.id)
          onAddClick()
        }}
      >
        +
      </button>
    </div>
  )
}
