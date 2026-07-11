import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'
import './App.css'
import { useTabsStore } from './state/tabsStore'
import { useLayoutStore } from './state/layoutStore'
import { findPane, makePane, mapTabIds, removeTab } from './lib/layoutTree'
import {
  buildProjectProfile,
  connectionConfigToOpenRequest,
  type ProjectProfileFile,
} from './lib/projectProfile'
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
import { FtpPanel } from './components/FtpPanel'
import { ToastStack } from './components/ToastStack'
import { useMqttStore } from './state/mqttStore'
import { useUdpStore } from './state/udpStore'
import { useWsStore } from './state/wsStore'
import {
  ChartIcon,
  DiskIcon,
  FolderIcon,
  GearIcon,
  GlobeIcon,
  ServerIcon,
  ZapIcon,
} from './components/icons'

const PROJECT_FILE_FILTERS = [{ name: 'EDT Project', extensions: ['edtproj'] }]

function App() {
  const { t } = useTranslation()
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
  const openTab = useTabsStore((s) => s.openTab)
  const setFilters = useTabsStore((s) => s.setFilters)
  const setTriggers = useTabsStore((s) => s.setTriggers)
  const setScriptCode = useTabsStore((s) => s.setScriptCode)
  const setLineEnding = useTabsStore((s) => s.setLineEnding)
  const setChecksumMode = useTabsStore((s) => s.setChecksumMode)
  const [showConnect, setShowConnect] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showFlash, setShowFlash] = useState(false)
  const [showNetScan, setShowNetScan] = useState(false)
  const [showFtp, setShowFtp] = useState(false)

  const theme = useSettingsStore((s) => s.theme)
  const fontSize = useSettingsStore((s) => s.fontSize)
  const keepAwake = useSettingsStore((s) => s.keepAwake)
  const plotVisible = usePlotStore((s) => s.visible)
  const setPlotVisible = usePlotStore((s) => s.setVisible)
  const plotSourceTabId = usePlotStore((s) => s.sourceTabId)
  const plotExtractors = usePlotStore((s) => s.extractors)
  const plotMathChannels = usePlotStore((s) => s.mathChannels)
  const plotThresholds = usePlotStore((s) => s.thresholds)
  const plotChartType = usePlotStore((s) => s.chartType)
  const plotLoadConfig = usePlotStore((s) => s.loadConfig)

  const layoutRoot = useLayoutStore((s) => s.root)
  const focusedPaneId = useLayoutStore((s) => s.focusedPaneId)
  const openTabInFocusedPane = useLayoutStore((s) => s.openTabInFocusedPane)
  const setActiveTabInPane = useLayoutStore((s) => s.setActiveTabInPane)
  const layoutCloseTab = useLayoutStore((s) => s.closeTab)
  const loadLayout = useLayoutStore((s) => s.loadLayout)

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
    ? (tabs.find((tab) => tab.id === focusedPane.activeTabId) ?? null)
    : null

  const handleSaveProject = async () => {
    const hasPlotterConfig =
      plotSourceTabId !== null ||
      plotExtractors.length > 0 ||
      plotMathChannels.length > 0 ||
      plotThresholds.length > 0
    const sourceIndex = plotSourceTabId ? tabs.findIndex((tab) => tab.id === plotSourceTabId) : -1
    const profile = buildProjectProfile(
      tabs,
      layoutRoot,
      hasPlotterConfig
        ? {
            sourceTabIndex: sourceIndex >= 0 ? sourceIndex : null,
            extractors: plotExtractors,
            mathChannels: plotMathChannels,
            thresholds: plotThresholds,
            chartType: plotChartType,
          }
        : null,
    )
    const path = await save({ filters: PROJECT_FILE_FILTERS, defaultPath: 'workspace.edtproj' })
    if (!path) return
    try {
      await invoke('write_text_file', { path, contents: JSON.stringify(profile, null, 2) })
    } catch (err) {
      window.alert(t('app.saveProjectError', { error: String(err) }))
    }
  }

  // Reopens every saved connection under a freshly assigned id (runtime ids
  // aren't stable across restarts), restoring per-tab filters/triggers/
  // scripts and rebuilding the Snap Layout tree from the saved placeholder
  // ids — see lib/projectProfile's module docs. SSH tabs pause for a
  // password prompt (never saved to disk); a tab that fails to (re)connect
  // or whose SSH prompt is cancelled is dropped from the restored layout
  // instead of leaving a dangling reference to a tab that doesn't exist.
  const handleOpenProject = async () => {
    const path = await open({ filters: PROJECT_FILE_FILTERS, multiple: false })
    if (!path || Array.isArray(path)) return

    let profile: ProjectProfileFile
    try {
      const contents = await invoke<string>('read_text_file', { path })
      profile = JSON.parse(contents) as ProjectProfileFile
    } catch (err) {
      window.alert(t('app.openProjectError', { error: String(err) }))
      return
    }

    // Opening a project replaces the whole layout, so any tab still open
    // from before wouldn't be reachable through the UI afterward even
    // though its connection stays alive underneath — close them first
    // rather than leaking invisible connections.
    if (hasAnyTabs) {
      if (!window.confirm(t('app.confirmCloseAllTabs'))) return
      await Promise.all(tabs.map((tab) => closeTab(tab.id)))
    }

    const idByIndex = new Map<number, string>()
    const failedIndices: number[] = []
    for (let i = 0; i < profile.tabs.length; i++) {
      const tabConfig = profile.tabs[i]
      const newId = `${tabConfig.connectionConfig.kind}-${Date.now()}-${i}`
      let sshPassword: string | undefined
      if (tabConfig.connectionConfig.kind === 'ssh') {
        const cfg = tabConfig.connectionConfig
        const entered = window.prompt(
          t('app.sshPasswordPrompt', { username: cfg.username, host: cfg.host, port: cfg.port }),
        )
        if (entered === null) {
          failedIndices.push(i)
          continue
        }
        sshPassword = entered
      }
      try {
        await openTab(connectionConfigToOpenRequest(tabConfig.connectionConfig, newId, sshPassword))
      } catch {
        failedIndices.push(i)
        continue
      }
      setFilters(newId, tabConfig.filters)
      setTriggers(newId, tabConfig.triggers)
      setScriptCode(newId, tabConfig.scriptCode)
      setLineEnding(newId, tabConfig.lineEnding)
      setChecksumMode(newId, tabConfig.checksumMode)
      idByIndex.set(i, newId)
    }

    let layout = profile.layout
    for (const i of failedIndices) {
      layout = removeTab(layout, String(i)) ?? makePane([])
    }
    loadLayout(mapTabIds(layout, (index) => idByIndex.get(Number(index)) ?? index))
    if (idByIndex.size > 0) setShowConnect(false)

    if (profile.plotter) {
      const sourceTabId =
        profile.plotter.sourceTabIndex !== null
          ? (idByIndex.get(profile.plotter.sourceTabIndex) ?? null)
          : null
      plotLoadConfig({ ...profile.plotter, sourceTabId })
      setPlotVisible(true)
    }

    if (failedIndices.length > 0) {
      window.alert(
        t('app.partialRestoreWarning', {
          failed: failedIndices.length,
          total: profile.tabs.length,
        }),
      )
    }
  }

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
        else if (showFtp) setShowFtp(false)
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
    showFtp,
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
          className="icon-button settings-trigger"
          aria-label={t('app.topbar.openProject')}
          title={t('app.topbar.openProjectTitle')}
          onClick={() => void handleOpenProject()}
        >
          <FolderIcon />
        </button>
        <button
          type="button"
          className="icon-button settings-trigger"
          aria-label={t('app.topbar.saveProject')}
          title={t('app.topbar.saveProjectTitle')}
          disabled={!hasAnyTabs}
          onClick={() => void handleSaveProject()}
        >
          <DiskIcon />
        </button>
        <button
          type="button"
          className={`icon-button settings-trigger ${plotVisible ? 'on' : ''}`}
          aria-label={t('app.topbar.plotter')}
          title={t('app.topbar.plotterTitle')}
          onClick={() => setPlotVisible(!plotVisible)}
        >
          <ChartIcon />
        </button>
        <button
          type="button"
          className="icon-button settings-trigger"
          aria-label={t('app.topbar.flashEsp32')}
          title={t('app.topbar.flashEsp32Title')}
          onClick={() => setShowFlash(true)}
        >
          <ZapIcon />
        </button>
        <button
          type="button"
          className="icon-button settings-trigger"
          aria-label={t('app.topbar.networkScanner')}
          title={t('app.topbar.networkScanner')}
          onClick={() => setShowNetScan(true)}
        >
          <GlobeIcon />
        </button>
        <button
          type="button"
          className="icon-button settings-trigger"
          aria-label={t('app.topbar.ftp')}
          title={t('app.topbar.ftp')}
          onClick={() => setShowFtp(true)}
        >
          <ServerIcon />
        </button>
        <button
          type="button"
          className="icon-button settings-trigger"
          aria-label={t('app.topbar.settings')}
          title={t('app.topbar.settingsTitle')}
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
      {showFtp && <FtpPanel onClose={() => setShowFtp(false)} />}
      <ToastStack />
    </div>
  )
}

export default App
