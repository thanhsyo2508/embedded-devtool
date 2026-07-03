import { useTabsStore } from '../state/tabsStore'

export function TabStrip({ onAddClick }: { onAddClick: () => void }) {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const setActiveTab = useTabsStore((s) => s.setActiveTab)
  const closeTab = useTabsStore((s) => s.closeTab)

  return (
    <div className="tab-strip">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
        >
          <span className={`status-dot ${tab.status}`} />
          <span className="tab-label">
            {tab.portName} · {tab.baudRate}
          </span>
          <button
            type="button"
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              void closeTab(tab.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="tab-add" onClick={onAddClick}>
        +
      </button>
    </div>
  )
}
