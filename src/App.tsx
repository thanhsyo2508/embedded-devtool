import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'
import { useTabsStore } from './state/tabsStore'
import { FONT_SIZE_PX, useSettingsStore } from './state/settingsStore'
import { useFlashStore } from './state/flashStore'
import { useStm32Store } from './state/stm32Store'
import { usePlotStore } from './state/plotStore'
import { TabStrip } from './components/TabStrip'
import { ConnectPanel } from './components/ConnectPanel'
import { MonitorView } from './components/MonitorView'
import { SendPanel } from './components/SendPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { FlashPanel } from './components/FlashPanel'
import { PlotDock } from './components/PlotDock'
import { WorkspaceResizer } from './components/WorkspaceResizer'
import { ChartIcon, GearIcon, ZapIcon } from './components/icons'

function App() {
  const wireEventsOnce = useTabsStore((s) => s.wireEventsOnce)
  const wireFlashEventsOnce = useFlashStore((s) => s.wireEventsOnce)
  const wireStm32EventsOnce = useStm32Store((s) => s.wireEventsOnce)
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const setActiveTab = useTabsStore((s) => s.setActiveTab)
  const closeTab = useTabsStore((s) => s.closeTab)
  const clearLines = useTabsStore((s) => s.clearLines)
  const togglePause = useTabsStore((s) => s.togglePause)
  const [showConnect, setShowConnect] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showFlash, setShowFlash] = useState(false)

  const theme = useSettingsStore((s) => s.theme)
  const fontSize = useSettingsStore((s) => s.fontSize)
  const keepAwake = useSettingsStore((s) => s.keepAwake)
  const plotVisible = usePlotStore((s) => s.visible)
  const setPlotVisible = usePlotStore((s) => s.setVisible)

  useEffect(() => {
    wireEventsOnce()
    wireFlashEventsOnce()
    wireStm32EventsOnce()
  }, [wireEventsOnce, wireFlashEventsOnce, wireStm32EventsOnce])

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

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  // M3-T2.2: global keyboard shortcuts. Ctrl on Windows/Linux, Cmd on macOS.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      const target = e.target as HTMLElement | null
      const isTyping = !!target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)

      if (e.key === 'Escape') {
        if (showSettings) setShowSettings(false)
        else if (showFlash) setShowFlash(false)
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
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'w') {
        if (activeTab) {
          e.preventDefault()
          void closeTab(activeTab.id)
        }
        return
      }
      if (mod && e.key.toLowerCase() === 'l') {
        if (activeTab && !showConnect) {
          e.preventDefault()
          clearLines(activeTab.id)
        }
        return
      }
      if (mod && e.key >= '1' && e.key <= '9') {
        const index = Number(e.key) - 1
        if (tabs[index]) {
          e.preventDefault()
          setActiveTab(tabs[index].id)
          setShowConnect(false)
        }
        return
      }
      if (!mod && e.key === ' ' && !isTyping) {
        if (activeTab && !showConnect) {
          e.preventDefault()
          togglePause(activeTab.id)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    activeTab,
    tabs,
    showConnect,
    showSettings,
    showFlash,
    plotVisible,
    closeTab,
    clearLines,
    togglePause,
    setActiveTab,
    setPlotVisible,
  ])

  return (
    <div className="app">
      <div className="app-topbar">
        <TabStrip onAddClick={() => setShowConnect(true)} />
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
          aria-label="Settings"
          title="Settings (Ctrl+,)"
          onClick={() => setShowSettings(true)}
        >
          <GearIcon />
        </button>
      </div>
      {showConnect || !activeTab ? (
        <ConnectPanel onConnected={() => setShowConnect(false)} />
      ) : (
        <div className="workspace">
          <div className="monitor-column">
            <MonitorView tab={activeTab} />
            <SendPanel tab={activeTab} />
          </div>
          {plotVisible && (
            <>
              <WorkspaceResizer />
              <PlotDock />
            </>
          )}
        </div>
      )}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showFlash && <FlashPanel onClose={() => setShowFlash(false)} />}
    </div>
  )
}

export default App
