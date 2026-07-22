import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { open, save } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'
import './App.css'
import { useTabsStore } from './state/tabsStore'
import { useSftpStore } from './state/sftpStore'
import { useFtpTreeStore } from './state/ftpTreeStore'
import { useLayoutStore } from './state/layoutStore'
import { findPane, findPaneForTab, makePane, mapTabIds, removeTab } from './lib/layoutTree'
import {
  buildProjectProfile,
  connectionConfigToOpenRequest,
  type ProjectProfileFile,
} from './lib/projectProfile'
import { FONT_SIZE_PX, useSettingsStore, type Language, type Theme } from './state/settingsStore'
import { restApiStart, restApiStop } from './api/restapi'
import { useDebugHandoffStore } from './state/debugHandoffStore'
import {
  useRecentConnectionsStore,
  recentConnectionToOpenRequest,
  type RecentConnection,
} from './state/recentConnectionsStore'
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
import { PluginLibraryPanel } from './components/PluginLibraryPanel'
import { ToastStack } from './components/ToastStack'
import { NotificationBell } from './components/NotificationBell'
import { RecentConnectionsMenu } from './components/RecentConnectionsMenu'
import { CommandPalette, type PaletteCommand } from './components/CommandPalette'
import { buildDiagnosticBundle } from './lib/diagnosticBundle'
import { GlobalSearchPanel } from './components/GlobalSearchPanel'
import { ShortcutOverlay } from './components/ShortcutOverlay'
import { OnboardingScreen } from './components/OnboardingScreen'
import { LogComparePanel } from './components/LogComparePanel'
import { BroadcastSendPanel } from './components/BroadcastSendPanel'
import { useSearchHandoffStore } from './state/searchHandoffStore'
import { useMqttStore } from './state/mqttStore'
import { useUdpStore } from './state/udpStore'
import { useWsStore } from './state/wsStore'
import {
  ChartIcon,
  CommandIcon,
  DiskIcon,
  FolderIcon,
  GearIcon,
  GlobeIcon,
  PuzzleIcon,
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
  const sftpSessions = useSftpStore((s) => s.sessions)
  const ftpSessions = useFtpTreeStore((s) => s.sessions)
  const closeTab = useTabsStore((s) => s.closeTab)
  const clearLines = useTabsStore((s) => s.clearLines)
  const togglePause = useTabsStore((s) => s.togglePause)
  const openTab = useTabsStore((s) => s.openTab)
  const setFilters = useTabsStore((s) => s.setFilters)
  const setTriggers = useTabsStore((s) => s.setTriggers)
  const setScriptCode = useTabsStore((s) => s.setScriptCode)
  const setLineEnding = useTabsStore((s) => s.setLineEnding)
  const setChecksumMode = useTabsStore((s) => s.setChecksumMode)
  const renameTab = useTabsStore((s) => s.renameTab)
  const setTabColor = useTabsStore((s) => s.setTabColor)
  const setTabEmoji = useTabsStore((s) => s.setTabEmoji)
  const [showConnect, setShowConnect] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showFlash, setShowFlash] = useState(false)
  const [showNetScan, setShowNetScan] = useState(false)
  const [showFtp, setShowFtp] = useState(false)
  const [showPlugins, setShowPlugins] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [showGlobalSearch, setShowGlobalSearch] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showLogCompare, setShowLogCompare] = useState(false)
  const [showBroadcast, setShowBroadcast] = useState(false)

  const theme = useSettingsStore((s) => s.theme)
  const fontSize = useSettingsStore((s) => s.fontSize)
  const uiScale = useSettingsStore((s) => s.uiScale)
  const accentColor = useSettingsStore((s) => s.accentColor)
  const onboardingDone = useSettingsStore((s) => s.onboardingDone)
  const setOnboardingDone = useSettingsStore((s) => s.setOnboardingDone)
  const keepAwake = useSettingsStore((s) => s.keepAwake)
  const restApiEnabled = useSettingsStore((s) => s.restApiEnabled)
  const restApiPort = useSettingsStore((s) => s.restApiPort)
  const restApiToken = useSettingsStore((s) => s.restApiToken)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const setLanguage = useSettingsStore((s) => s.setLanguage)
  const recentConnections = useRecentConnectionsStore((s) => s.items)
  const pushRecentConnection = useRecentConnectionsStore((s) => s.push)
  const pendingBacktraceText = useDebugHandoffStore((s) => s.pendingBacktraceText)
  const plotVisible = usePlotStore((s) => s.visible)
  const setPlotVisible = usePlotStore((s) => s.setVisible)
  const plotSourceTabId = usePlotStore((s) => s.sourceTabId)
  const plotExtractors = usePlotStore((s) => s.extractors)
  const plotMathChannels = usePlotStore((s) => s.mathChannels)
  const plotThresholds = usePlotStore((s) => s.thresholds)
  const plotMqttFields = usePlotStore((s) => s.mqttFields)
  const plotChartType = usePlotStore((s) => s.chartType)
  const plotChannelColors = usePlotStore((s) => s.channelColors)
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

  // Scales the whole UI (text, icons, spacing) via CSS zoom on the app
  // root, not just the monitor's log text — for users who find the default
  // size too small overall, with a wider range than the 3-step Font Size
  // preset above.
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', `${uiScale}%`)
  }, [uiScale])

  // A custom accent wins over the stylesheet's per-theme --accent (inline
  // styles beat stylesheet rules), so it applies in both light and dark;
  // clearing it removes the override and lets the theme's default show.
  useEffect(() => {
    if (accentColor) {
      document.documentElement.style.setProperty('--accent', accentColor)
    } else {
      document.documentElement.style.removeProperty('--accent')
    }
  }, [accentColor])

  useEffect(() => {
    void invoke('set_keep_awake', { enabled: keepAwake }).catch(() => {})
  }, [keepAwake])

  // The monitor's right-click "Decode as crash backtrace" action requests
  // this from deep inside a pane — react to it here rather than threading
  // a callback all the way down, since FlashPanel already reads the same
  // handoff store to default its target to the Debug tab. Adjusted during
  // render rather than in an effect, per React's guidance for reacting to
  // a changed value (same pattern as ConnectPanel's presetsFor).
  const [handledBacktraceText, setHandledBacktraceText] = useState<string | null>(null)
  if (pendingBacktraceText !== null && pendingBacktraceText !== handledBacktraceText) {
    setHandledBacktraceText(pendingBacktraceText)
    setShowFlash(true)
  }

  // Restarts the server (stop, then start with whatever's current) on any
  // change so toggling the setting, or editing the port/token while
  // enabled, always converges to matching backend state — rest_api_stop
  // is a no-op if nothing's running, so this is safe on first mount too.
  useEffect(() => {
    void restApiStop().finally(() => {
      if (restApiEnabled) {
        void restApiStart(restApiPort, restApiToken).catch((err: unknown) => {
          window.alert(t('settings.restApi.startError', { error: String(err) }))
        })
      }
    })
  }, [restApiEnabled, restApiPort, restApiToken, t])

  const hasAnyTabs = tabs.length > 0
  const focusedPane = findPane(layoutRoot, focusedPaneId)
  const focusedTab = focusedPane
    ? (tabs.find((tab) => tab.id === focusedPane.activeTabId) ?? null)
    : null

  const handleExportDiagnostics = async () => {
    const path = await save({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      defaultPath: `edt-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
    })
    if (!path) return
    try {
      const version = await getVersion().catch(() => 'unknown')
      const bundle = buildDiagnosticBundle({
        version,
        platform: navigator.userAgent,
        tabs: useTabsStore.getState().tabs,
        settings: useSettingsStore.getState() as unknown as Record<string, unknown>,
      })
      await invoke('write_text_file', { path, contents: bundle })
    } catch (err) {
      window.alert(String(err))
    }
  }

  const handleSaveProject = async () => {
    const hasPlotterConfig =
      plotSourceTabId !== null ||
      plotExtractors.length > 0 ||
      plotMathChannels.length > 0 ||
      plotThresholds.length > 0 ||
      plotMqttFields.length > 0
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
            channelColors: plotChannelColors,
            mqttFields: plotMqttFields,
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
  // ids — see lib/projectProfile's module docs. SSH/FTP tabs pause for a
  // password prompt (never saved to disk); a tab that fails to (re)connect
  // or whose prompt is cancelled is dropped from the restored layout
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
      let passwordOverride: string | undefined
      if (tabConfig.connectionConfig.kind === 'ssh') {
        const cfg = tabConfig.connectionConfig
        const entered = window.prompt(
          t('app.sshPasswordPrompt', { username: cfg.username, host: cfg.host, port: cfg.port }),
        )
        if (entered === null) {
          failedIndices.push(i)
          continue
        }
        passwordOverride = entered
      } else if (tabConfig.connectionConfig.kind === 'ftp') {
        const cfg = tabConfig.connectionConfig
        const entered = window.prompt(
          t('app.ftpPasswordPrompt', { username: cfg.username, host: cfg.host, port: cfg.port }),
        )
        if (entered === null) {
          failedIndices.push(i)
          continue
        }
        passwordOverride = entered
      }
      try {
        await openTab(
          connectionConfigToOpenRequest(tabConfig.connectionConfig, newId, passwordOverride),
        )
      } catch {
        failedIndices.push(i)
        continue
      }
      setFilters(newId, tabConfig.filters)
      setTriggers(newId, tabConfig.triggers)
      setScriptCode(newId, tabConfig.scriptCode)
      setLineEnding(newId, tabConfig.lineEnding)
      setChecksumMode(newId, tabConfig.checksumMode)
      if (tabConfig.customLabel) renameTab(newId, tabConfig.customLabel)
      if (tabConfig.tabColor) setTabColor(newId, tabConfig.tabColor)
      if (tabConfig.tabEmoji) setTabEmoji(newId, tabConfig.tabEmoji)
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

  // One-click reconnect from the command palette — SSH/FTP are the only
  // kinds that need a prompt first, since their password is deliberately
  // never persisted (see ConnectPanel's currentConfigData).
  const handleReconnectRecent = async (recent: RecentConnection) => {
    let passwordOverride: string | undefined
    if (recent.kind === 'ssh' || recent.kind === 'ftp') {
      const promptKey = recent.kind === 'ssh' ? 'app.sshPasswordPrompt' : 'app.ftpPasswordPrompt'
      const entered = window.prompt(
        t(promptKey, {
          username: recent.config.username,
          host: recent.config.host,
          port: recent.config.port,
        }),
      )
      if (entered === null) return
      passwordOverride = entered
    }
    const id = `${recent.kind}-${Date.now()}`
    try {
      await openTab(recentConnectionToOpenRequest(recent, id, passwordOverride))
      pushRecentConnection(recent.kind, recent.config, recent.label)
      openTabInFocusedPane(id)
      setShowConnect(false)
    } catch (err) {
      window.alert(String(err))
    }
  }

  // Ctrl+K quick-open — see CommandPalette's module doc. Built here (not
  // inside that component) since every action needs this component's own
  // setShowX state/handlers; recomputed whenever what a command should do
  // or whether it applies (e.g. "Close tab" needs a focused tab) changes.
  const paletteCommands: PaletteCommand[] = useMemo(() => {
    // Only actually built while the palette is open. `tabs` is a dependency
    // (the command list reflects open tabs and their browsed remote files),
    // and `tabs` gets a fresh identity on every ~60fps data batch — so
    // without this guard the whole list, including the nested walk over
    // every SFTP/FTP tree node, would be rebuilt 60 times a second even
    // though the palette is closed almost always. CommandPalette isn't
    // mounted while closed, so returning an empty list here costs nothing.
    if (!showPalette) return []
    const navigate = t('commandPalette.category.navigate')
    const project = t('commandPalette.category.project')
    const tabCategory = t('commandPalette.category.tab')
    const recentCategory = t('commandPalette.category.recent')
    const preferences = t('commandPalette.category.preferences')
    const commands: PaletteCommand[] = [
      {
        id: 'new-connection',
        category: navigate,
        label: t('connect.title'),
        shortcut: 'Ctrl+N',
        run: () => setShowConnect(true),
      },
      {
        id: 'toggle-plotter',
        category: navigate,
        label: t('app.topbar.plotter'),
        shortcut: 'Ctrl+Shift+P',
        run: () => setPlotVisible(!plotVisible),
      },
      {
        id: 'flash',
        category: navigate,
        label: t('app.topbar.flashEsp32'),
        shortcut: 'Ctrl+Shift+F',
        run: () => setShowFlash(true),
      },
      {
        id: 'global-search',
        category: navigate,
        label: t('globalSearch.title'),
        shortcut: 'Ctrl+Shift+G',
        run: () => setShowGlobalSearch(true),
      },
      {
        id: 'log-compare',
        category: navigate,
        label: t('logCompare.title'),
        run: () => setShowLogCompare(true),
      },
      {
        id: 'broadcast-send',
        category: navigate,
        label: t('broadcast.title'),
        run: () => setShowBroadcast(true),
      },
      {
        id: 'export-diagnostics',
        category: project,
        label: t('diagnostics.export'),
        run: () => void handleExportDiagnostics(),
      },
      {
        id: 'netscan',
        category: navigate,
        label: t('app.topbar.networkScanner'),
        run: () => setShowNetScan(true),
      },
      { id: 'ftp', category: navigate, label: t('app.topbar.ftp'), run: () => setShowFtp(true) },
      {
        id: 'plugins',
        category: navigate,
        label: t('app.topbar.plugins'),
        run: () => setShowPlugins(true),
      },
      {
        id: 'settings',
        category: navigate,
        label: t('app.topbar.settings'),
        shortcut: 'Ctrl+,',
        run: () => setShowSettings(true),
      },
      {
        id: 'open-project',
        category: project,
        label: t('app.topbar.openProject'),
        run: () => void handleOpenProject(),
      },
    ]
    if (hasAnyTabs) {
      commands.push({
        id: 'save-project',
        category: project,
        label: t('app.topbar.saveProject'),
        run: () => void handleSaveProject(),
      })
    }
    if (focusedTab) {
      commands.push(
        {
          id: 'close-tab',
          category: tabCategory,
          label: t('commandPalette.closeTab'),
          shortcut: 'Ctrl+W',
          run: () => {
            void closeTab(focusedTab.id)
            layoutCloseTab(focusedTab.id)
          },
        },
        {
          id: 'clear-tab',
          category: tabCategory,
          label: t('commandPalette.clearTab'),
          shortcut: 'Ctrl+L',
          run: () => clearLines(focusedTab.id),
        },
      )
    }

    for (const tab of tabs) {
      commands.push({
        id: `switch-tab-${tab.id}`,
        category: tabCategory,
        label: t('commandPalette.switchToTab', { label: tab.connectionLabel }),
        run: () => {
          const pane = findPaneForTab(layoutRoot, tab.id)
          if (pane) setActiveTabInPane(pane.id, tab.id)
          setShowConnect(false)
        },
      })
    }

    // Quick-open for remote files already browsed into an SSH tab's SFTP
    // sidebar (or an FTP tab's own tree) — client-side filter over
    // already-fetched entries only, not a new recursive backend search
    // (deliberate v1 scope boundary).
    const remoteFilesCategory = t('commandPalette.category.remoteFiles')
    for (const tab of tabs) {
      if (tab.connectionKind === 'ssh') {
        const session = sftpSessions[tab.id]
        if (!session) continue
        for (const node of Object.values(session.nodes)) {
          for (const entry of node.entries ?? []) {
            if (entry.isDir) continue
            commands.push({
              id: `remote-open-${tab.id}-${entry.path}`,
              category: remoteFilesCategory,
              label: t('commandPalette.openRemoteFile', {
                path: entry.path,
                label: tab.connectionLabel,
              }),
              run: () => {
                const pane = findPaneForTab(layoutRoot, tab.id)
                if (pane) setActiveTabInPane(pane.id, tab.id)
                void useSftpStore.getState().openFile(tab.id, entry)
              },
            })
          }
        }
      } else if (tab.connectionKind === 'ftp') {
        const session = ftpSessions[tab.id]
        if (!session) continue
        for (const node of Object.values(session.nodes)) {
          for (const entry of node.entries ?? []) {
            if (entry.isDir) continue
            commands.push({
              id: `remote-open-${tab.id}-${entry.path}`,
              category: remoteFilesCategory,
              label: t('commandPalette.openRemoteFile', {
                path: entry.path,
                label: tab.connectionLabel,
              }),
              run: () => {
                const pane = findPaneForTab(layoutRoot, tab.id)
                if (pane) setActiveTabInPane(pane.id, tab.id)
                void useFtpTreeStore.getState().openFile(tab.id, entry)
              },
            })
          }
        }
      }
    }

    // Capped at 5 — the palette is for quick recall, not a full duplicate
    // of ConnectPanel's Recent list (which shows all of them).
    for (const recent of recentConnections.slice(0, 5)) {
      commands.push({
        id: `reconnect-${recent.id}`,
        category: recentCategory,
        label: t('commandPalette.reconnectTo', { label: recent.label }),
        run: () => void handleReconnectRecent(recent),
      })
    }

    const themes: Theme[] = ['system', 'dark', 'light']
    for (const themeOption of themes) {
      commands.push({
        id: `theme-${themeOption}`,
        category: preferences,
        label: t('commandPalette.setTheme', { theme: t(`settings.theme.${themeOption}`) }),
        run: () => setTheme(themeOption),
      })
    }

    const languages: [Language, string][] = [
      ['en', t('settings.languageEnglish')],
      ['vi', t('settings.languageVietnamese')],
    ]
    for (const [code, label] of languages) {
      commands.push({
        id: `language-${code}`,
        category: preferences,
        label: t('commandPalette.setLanguage', { language: label }),
        run: () => setLanguage(code),
      })
    }

    return commands
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    showPalette,
    t,
    hasAnyTabs,
    focusedTab,
    plotVisible,
    tabs,
    layoutRoot,
    recentConnections,
    sftpSessions,
    ftpSessions,
  ])

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
        if (showShortcuts) setShowShortcuts(false)
        else if (showLogCompare) setShowLogCompare(false)
        else if (showBroadcast) setShowBroadcast(false)
        else if (showPalette) setShowPalette(false)
        else if (showGlobalSearch) setShowGlobalSearch(false)
        else if (showSettings) setShowSettings(false)
        else if (showFlash) setShowFlash(false)
        else if (showNetScan) setShowNetScan(false)
        else if (showFtp) setShowFtp(false)
        else if (showPlugins) setShowPlugins(false)
        else if (showConnect && hasAnyTabs) setShowConnect(false)
        return
      }

      // `?` (Shift+/) opens the shortcut cheat-sheet — only when not typing,
      // so it doesn't hijack a literal question mark in a text field.
      if (!mod && !isTyping && e.key === '?') {
        e.preventDefault()
        setShowShortcuts((v) => !v)
        return
      }

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowPalette((v) => !v)
        return
      }

      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setShowFlash((v) => !v)
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        setShowGlobalSearch((v) => !v)
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
    showPlugins,
    showPalette,
    showGlobalSearch,
    showShortcuts,
    showLogCompare,
    showBroadcast,
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
        <div className="topbar-group">
          <RecentConnectionsMenu onReconnect={(recent) => void handleReconnectRecent(recent)} />
        </div>
        <div className="topbar-group">
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
        </div>
        <div className="topbar-group">
          <button
            type="button"
            className={`icon-button settings-trigger ${plotVisible ? 'on' : ''}`}
            aria-label={t('app.topbar.plotter')}
            title={t('app.topbar.plotterTitle')}
            onClick={() => setPlotVisible(!plotVisible)}
          >
            <ChartIcon />
          </button>
        </div>
        <div className="topbar-group">
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
            aria-label={t('app.topbar.plugins')}
            title={t('app.topbar.plugins')}
            onClick={() => setShowPlugins(true)}
          >
            <PuzzleIcon />
          </button>
        </div>
        <div className="topbar-group">
          <button
            type="button"
            className="icon-button settings-trigger"
            aria-label={t('commandPalette.open')}
            title={t('commandPalette.openTitle')}
            onClick={() => setShowPalette(true)}
          >
            <CommandIcon />
          </button>
          <NotificationBell />
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
      {showPlugins && <PluginLibraryPanel onClose={() => setShowPlugins(false)} />}
      {showPalette && (
        <CommandPalette commands={paletteCommands} onClose={() => setShowPalette(false)} />
      )}
      {showGlobalSearch && (
        <GlobalSearchPanel
          onClose={() => setShowGlobalSearch(false)}
          onJumpToMatch={(tabId, query, seq) => {
            const pane = findPaneForTab(layoutRoot, tabId)
            if (pane) setActiveTabInPane(pane.id, tabId)
            useSearchHandoffStore.getState().requestJumpToMatch(tabId, query, seq)
          }}
        />
      )}
      {showShortcuts && <ShortcutOverlay onClose={() => setShowShortcuts(false)} />}
      {showLogCompare && <LogComparePanel onClose={() => setShowLogCompare(false)} />}
      {showBroadcast && <BroadcastSendPanel onClose={() => setShowBroadcast(false)} />}
      {!onboardingDone && <OnboardingScreen onDismiss={() => setOnboardingDone(true)} />}
      <ToastStack />
    </div>
  )
}

export default App
