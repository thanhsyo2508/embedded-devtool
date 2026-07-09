import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'
import { useTabsStore } from './state/tabsStore'
import { useLayoutStore } from './state/layoutStore'
import { findPane } from './lib/layoutTree'
import { FONT_SIZE_PX, useSettingsStore } from './state/settingsStore'
import { useFlashStore } from './state/flashStore'
import { useStm32Store } from './state/stm32Store'
import { usePlotStore } from './state/plotStore'
import { PaneView } from './components/PaneView'
import { ConnectPanel } from './components/ConnectPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { FlashPanel } from './components/FlashPanel'
import { PlotDock } from './components/PlotDock'
import { WorkspaceResizer } from './components/WorkspaceResizer'
import { NetScanPanel } from './components/NetScanPanel'
import { useMqttStore } from './state/mqttStore'
import { useUdpStore } from './state/udpStore'
import { useWsStore } from './state/wsStore'
import { ChartIcon, GearIcon, GlobeIcon, ZapIcon } from './components/icons'

function App() {
  const wireEventsOnce = useTabsStore((s) => s.wireEventsOnce)
  const wireFlashEventsOnce = useFlashStore((s) => s.wireEventsOnce)
  const wireStm32EventsOnce = useStm32Store((s) => s.wireEventsOnce)
  const wireMqttEventsOnce = useMqttStore((s) => s.wireEventsOnce)
  const wireUdpEventsOnce = useUdpStore((s) => s.wireEventsOnce)
  const wireWsEventsOnce = useWsStore((s) => s.wireEventsOnce)
  const tabs = useTabsStore((s) => s.tabs)
  const closeTab = useTabsStore((s) => s.closeTab)
  const clearLines = useTabsStore((s) => s.clearLines)
  const togglePause = useTabsStore((s) => s.togglePause)
  const [showConnect, setShowConnect] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showFlash, setShowFlash] = useState(false)
  const [showNetScan, setShowNetScan] = useState(false)

  const theme = useSettingsStore((s) => s.theme)
  const fontSize = useSettingsStore((s) => s.fontSize)
  const keepAwake = useSettingsStore((s) => s.keepAwake)
  const plotVisible = usePlotStore((s) => s.visible)
  const setPlotVisible = usePlotStore((s) => s.setVisible)

  const layoutRoot = useLayoutStore((s) => s.root)
  const focusedPaneId = useLayoutStore((s) => s.focusedPaneId)
  const openTabInFocusedPane = useLayoutStore((s) => s.openTabInFocusedPane)
  const setActiveTabInPane = useLayoutStore((s) => s.setActiveTabInPane)
  const layoutCloseTab = useLayoutStore((s) => s.closeTab)

  useEffect(() => {
    wireEventsOnce()
    wireFlashEventsOnce()
    wireStm32EventsOnce()
    wireMqttEventsOnce()
    wireUdpEventsOnce()
    wireWsEventsOnce()
  }, [
    wireEventsOnce,
    wireFlashEventsOnce,
    wireStm32EventsOnce,
    wireMqttEventsOnce,
    wireUdpEventsOnce,
    wireWsEventsOnce,
  ])

  useEffect(() => {
    if (theme === 'system') {
      delete document.documentElement.dataset.theme
    } else {
      document.documentElement.dataset.theme = theme
    }
  }, [theme])

  useEffect(() => {
    document.documentElement.style.setProperty('--log-font-size', FONT_SIZE_PX[fontSize])
  }, [fontSize])

  useEffect(() => {
    void invoke('set_keep_awake', { enabled: keepAwake }).catch(() => {})
  }, [keepAwake])

  const hasAnyTabs = tabs.length > 0
  const focusedPane = findPane(layoutRoot, focusedPaneId)
  const focusedTab = focusedPane
    ? (tabs.find((t) => t.id === focusedPane.activeTabId) ?? null)
    : null

  // M3-T2.2: global keyboard shortcuts. Ctrl on Windows/Linux, Cmd on macOS.
  // Shortcuts that target "the current tab" now act on the focused pane's
  // active tab, since there's no longer a single global active tab once
  // panes can split.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const target = e.target as HTMLElement | null
      const isTyping = !!target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)

      if (e.key === 'Escape') {
        if (showSettings) setShowSettings(false)
        else if (showFlash) setShowFlash(false)
        else if (showNetScan) setShowNetScan(false)
        else if (showConnect && hasAnyTabs) setShowConnect(false)
        return
      }

      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setShowFlash((v) => !v)
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPlotVisible(!plotVisible)
        return
      }
      if (mod && e.key === ',') {
        e.preventDefault()
        setShowSettings((v) => !v)
        return
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setShowConnect(true)
        return
      }
      // Ctrl+W (delete word) and Ctrl+L (clear screen) are load-bearing
      // shell keybindings — let an SSH tab's terminal have them instead of
      // treating them as app-level "close tab"/"clear log" shortcuts.
      const isSshFocused = focusedTab?.connectionKind === 'ssh' && !showConnect
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'w') {
        if (focusedTab && !isSshFocused) {
          e.preventDefault()
          void closeTab(focusedTab.id)
          layoutCloseTab(focusedTab.id)
        }
        return
      }
      if (mod && e.key.toLowerCase() === 'l') {
        if (focusedTab && !showConnect && !isSshFocused) {
          e.preventDefault()
          clearLines(focusedTab.id)
        }
        return
      }
      if (mod && e.key >= '1' && e.key <= '9') {
        const index = Number(e.key) - 1
        if (focusedPane && focusedPane.tabIds[index]) {
          e.preventDefault()
          setActiveTabInPane(focusedPane.id, focusedPane.tabIds[index])
          setShowConnect(false)
        }
        return
      }
      if (!mod && e.key === ' ' && !isTyping) {
        if (focusedTab && !showConnect) {
          e.preventDefault()
          togglePause(focusedTab.id)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    focusedTab,
    focusedPane,
    showConnect,
    showSettings,
    showFlash,
    showNetScan,
    hasAnyTabs,
    plotVisible,
    closeTab,
    layoutCloseTab,
    clearLines,
    togglePause,
    setActiveTabInPane,
    setPlotVisible,
  ])

  return (
    <div className="app">
      <div className="app-topbar">
        <div className="app-topbar-spacer" />
        <button
          type="button"
          className={`icon-button settings-trigger ${plotVisible ? 'on' : ''}`}
          aria-label="Plotter"
          title="Plotter (Ctrl+Shift+P)"
          onClick={() => setPlotVisible(!plotVisible)}
        >
          <ChartIcon />
        </button>
        <button
          type="button"
          className="icon-button settings-trigger"
          aria-label="Flash ESP32"
          title="Flash ESP32 (Ctrl+Shift+F)"
          onClick={() => setShowFlash(true)}
        >
          <ZapIcon />
        </button>
        <button
          type="button"
          className="icon-button settings-trigger"
          aria-label="Network Scanner"
          title="Network Scanner"
          onClick={() => setShowNetScan(true)}
        >
          <GlobeIcon />
        </button>
        <button
          type="button"
          className="icon-button settings-trigger"
          aria-label="Settings"
          title="Settings (Ctrl+,)"
          onClick={() => setShowSettings(true)}
        >
          <GearIcon />
        </button>
      </div>
      <div className="workspace">
        <div className="pane-tree">
          <PaneView node={layoutRoot} onAddClick={() => setShowConnect(true)} />
        </div>
        {plotVisible && (
          <>
            <WorkspaceResizer />
            <PlotDock />
          </>
        )}
        {showConnect && (
          <ConnectPanel
            onConnected={(tabId) => {
              openTabInFocusedPane(tabId)
              setShowConnect(false)
            }}
            onCancel={hasAnyTabs ? () => setShowConnect(false) : undefined}
          />
        )}
      </div>
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showFlash && <FlashPanel onClose={() => setShowFlash(false)} />}
      {showNetScan && <NetScanPanel onClose={() => setShowNetScan(false)} />}
    </div>
  )
}

export default App
