import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PaneNode } from '../lib/layoutTree'
import { useLayoutStore } from '../state/layoutStore'
import { useTabsStore, type ConnectionKind } from '../state/tabsStore'
import { connectionConfigToOpenRequest } from '../lib/projectProfile'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { ChipIcon, CodeIcon, GlobeIcon, MessageIcon, ServerIcon, UsbIcon } from './icons'

// Module-scoped so the `Date.now()` call isn't in a component's render scope
// (the react-hooks purity rule flags impure calls there) — same reason
// QuickCommandsBar keeps its id generator at module level.
function freshTabId(kind: string): string {
  return `${kind}-${Date.now()}`
}

// Curated quick-picks for the tab context menu's color/emoji rows; a blank
// entry (rendered as a slash) clears the current choice.
const TAB_COLORS = ['#e05252', '#e0952b', '#4a9e4a', '#3b82c4', '#8b5cf6', '#c4519e']
const TAB_EMOJIS = ['🔴', '🟢', '🔵', '⚡', '🐛', '📟', '🚀', '⚙️']

// One glyph carries the connection's *type* (its shape) and *status* (its
// colour, via the status-* class) so a strip of same-looking labels — three
// "COM3 · 115200" tabs, say — is still scannable at a glance. Grouped by
// family rather than one-icon-per-kind: the label already spells out the
// specifics (host:port, server vs client), the icon just answers "serial /
// network / terminal / debug?".
function TabTypeIcon({ kind, status }: { kind: ConnectionKind; status: string }) {
  const className = `tab-icon status-${status}`
  switch (kind) {
    case 'serial':
      return <UsbIcon className={className} />
    case 'mqtt':
      return <MessageIcon className={className} />
    case 'ssh':
      return <CodeIcon className={className} />
    case 'ftp':
      return <ServerIcon className={className} />
    case 'rtt':
      return <ChipIcon className={className} />
    default:
      // tcp-client/server, udp, ws-client/server — all network byte streams.
      return <GlobeIcon className={className} />
  }
}

// Per-pane tab strip: reads only its own pane's tabIds (not the global tab
// list) so multiple panes can each show a different subset of open tabs.
// Tabs are made native HTML5 drag sources here; PaneContent's content area
// is the drop target for creating a new split, this strip is the drop
// target for merging a tab back into this pane, and each tab is a drop
// target for reordering within the pane (or merging a tab dropped onto it).
export function TabStrip({
  pane,
  onAddClick,
  onCloseTab,
}: {
  pane: PaneNode
  onAddClick: () => void
  onCloseTab: (tabId: string) => void
}) {
  const { t } = useTranslation()
  const allTabs = useTabsStore((s) => s.tabs)
  const openTab = useTabsStore((s) => s.openTab)
  const renameTab = useTabsStore((s) => s.renameTab)
  const setTabColor = useTabsStore((s) => s.setTabColor)
  const setTabEmoji = useTabsStore((s) => s.setTabEmoji)
  const reconnectTab = useTabsStore((s) => s.reconnectTab)
  const disconnectTab = useTabsStore((s) => s.disconnectTab)
  const setActiveTabInPane = useLayoutStore((s) => s.setActiveTabInPane)
  const focusPane = useLayoutStore((s) => s.focusPane)
  const moveTabToPane = useLayoutStore((s) => s.moveTabToPane)
  const reorderTabInPane = useLayoutStore((s) => s.reorderTabInPane)
  const openTabInFocusedPane = useLayoutStore((s) => s.openTabInFocusedPane)
  const [dragOver, setDragOver] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)

  const tabs = pane.tabIds
    .map((id) => allTabs.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => !!t)

  const handleRename = (tab: (typeof tabs)[number]) => {
    const next = window.prompt(t('tabMenu.renamePrompt'), tab.customLabel ?? tab.connectionLabel)
    if (next !== null) renameTab(tab.id, next)
  }

  const handleDuplicate = async (tab: (typeof tabs)[number]) => {
    const newId = freshTabId(tab.connectionKind)
    const passwordOverride =
      tab.connectionConfig.kind === 'ssh' || tab.connectionConfig.kind === 'ftp'
        ? tab.connectionConfig.password
        : undefined
    try {
      await openTab(connectionConfigToOpenRequest(tab.connectionConfig, newId, passwordOverride))
      focusPane(pane.id)
      openTabInFocusedPane(newId)
      if (tab.customLabel) renameTab(newId, `${tab.customLabel} (copy)`)
    } catch (err) {
      window.alert(String(err))
    }
  }

  const handleCloseOthers = (keepId: string) => {
    // pane.tabIds is a snapshot — safe to iterate while onCloseTab mutates
    // the live layout/tab lists underneath.
    for (const tabId of pane.tabIds) {
      if (tabId !== keepId) onCloseTab(tabId)
    }
  }

  const menuTab = menu ? tabs.find((tb) => tb.id === menu.tabId) : null
  const menuItems: ContextMenuItem[] = menuTab
    ? [
        { label: t('tabMenu.rename'), onClick: () => handleRename(menuTab) },
        {
          separatorBefore: true,
          render: (
            <div className="tab-menu-picker" role="group" aria-label={t('tabMenu.color')}>
              <button
                type="button"
                className="tab-menu-swatch tab-menu-clear"
                title={t('tabMenu.clearColor')}
                onClick={() => setTabColor(menuTab.id, '')}
              />
              {TAB_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`tab-menu-swatch ${menuTab.tabColor === color ? 'on' : ''}`}
                  style={{ background: color }}
                  onClick={() => setTabColor(menuTab.id, color)}
                />
              ))}
            </div>
          ),
        },
        {
          render: (
            <div className="tab-menu-picker" role="group" aria-label={t('tabMenu.emoji')}>
              <button
                type="button"
                className="tab-menu-emoji tab-menu-clear"
                title={t('tabMenu.clearEmoji')}
                onClick={() => setTabEmoji(menuTab.id, '')}
              />
              {TAB_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={`tab-menu-emoji ${menuTab.tabEmoji === emoji ? 'on' : ''}`}
                  onClick={() => setTabEmoji(menuTab.id, emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ),
        },
        menuTab.status === 'open'
          ? {
              label: t('tabMenu.disconnect'),
              onClick: () => void disconnectTab(menuTab.id),
              separatorBefore: true,
            }
          : {
              label: t('tabMenu.reconnect'),
              onClick: () => void reconnectTab(menuTab.id),
              separatorBefore: true,
            },
        {
          label: t('tabMenu.duplicate'),
          onClick: () => void handleDuplicate(menuTab),
          separatorBefore: true,
        },
        { label: t('tabMenu.close'), onClick: () => onCloseTab(menuTab.id), separatorBefore: true },
        {
          label: t('tabMenu.closeOthers'),
          onClick: () => handleCloseOthers(menuTab.id),
          disabled: tabs.length <= 1,
        },
      ]
    : []

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
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            // Stop the strip-level handler from also firing a plain
            // move-to-pane, which would fight the reorder below.
            e.stopPropagation()
            setDragOver(false)
            const draggedId = e.dataTransfer.getData('text/plain')
            if (!draggedId) return
            if (pane.tabIds.includes(draggedId)) reorderTabInPane(pane.id, draggedId, tab.id)
            else moveTabToPane(draggedId, pane.id)
          }}
          onClick={() => setActiveTabInPane(pane.id, tab.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            setActiveTabInPane(pane.id, tab.id)
            setMenu({ x: e.clientX, y: e.clientY, tabId: tab.id })
          }}
          title={tab.customLabel ? tab.connectionLabel : undefined}
          style={tab.tabColor ? { boxShadow: `inset 3px 0 0 ${tab.tabColor}` } : undefined}
        >
          {tab.tabEmoji ? (
            <span className="tab-emoji" aria-hidden>
              {tab.tabEmoji}
            </span>
          ) : (
            <TabTypeIcon kind={tab.connectionKind} status={tab.status} />
          )}
          <span className="tab-label">{tab.customLabel ?? tab.connectionLabel}</span>
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
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
