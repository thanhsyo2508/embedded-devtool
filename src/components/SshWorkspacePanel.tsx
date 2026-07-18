import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SshTerminalGroups } from './SshTerminalGroups'
import { SftpTreeSidebar } from './SftpTreeSidebar'
import { SftpEditorTabs } from './SftpEditorTabs'
import { DEFAULT_SFTP_SESSION, useSftpStore, type SftpConnectionConfig } from '../state/sftpStore'
import type { TabState } from '../state/tabsStore'
import { ChevronDownIcon, FolderIcon } from './icons'

const MIN_SIDEBAR_WIDTH = 160
const MAX_SIDEBAR_WIDTH = 480
const DEFAULT_SIDEBAR_WIDTH = 240
const MIN_TERMINAL_HEIGHT = 120
const MAX_TERMINAL_HEIGHT = 700
const DEFAULT_TERMINAL_HEIGHT = 240
const TERMINAL_HEADER_HEIGHT = 32

function SidebarResizer({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  const dragStart = useRef<{ x: number; width: number } | null>(null)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = { x: e.clientX, width }
    const handleMove = (moveEvent: PointerEvent) => {
      if (!dragStart.current) return
      const delta = moveEvent.clientX - dragStart.current.x
      const next = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, dragStart.current.width + delta),
      )
      onChange(next)
    }
    const handleUp = () => {
      dragStart.current = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  return <div className="sftp-sidebar-resizer" onPointerDown={handlePointerDown} />
}

function TerminalDockResizer({
  height,
  onChange,
}: {
  height: number
  onChange: (h: number) => void
}) {
  const dragStart = useRef<{ y: number; height: number } | null>(null)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = { y: e.clientY, height }
    const handleMove = (moveEvent: PointerEvent) => {
      if (!dragStart.current) return
      const delta = dragStart.current.y - moveEvent.clientY
      const next = Math.min(
        MAX_TERMINAL_HEIGHT,
        Math.max(MIN_TERMINAL_HEIGHT, dragStart.current.height + delta),
      )
      onChange(next)
    }
    const handleUp = () => {
      dragStart.current = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  return <div className="terminal-dock-resizer" onPointerDown={handlePointerDown} />
}

/** VSCode-Remote-SSH-style workspace for an SSH tab: a collapsible SFTP
 * file-tree sidebar, opened remote files as editor tabs (optionally split
 * into two side-by-side groups) in the main area, and one or more terminals
 * (also optionally split into two side-by-side groups, see
 * SshTerminalGroups) demoted to a collapsible/resizable bottom dock instead
 * of filling the tab. Every terminal — the tab's own default one and any
 * extras, in either dock group — renders unconditionally, always mounted;
 * switching which one is visible or collapsing the dock is pure CSS, never
 * conditional JSX, so no terminal's PTY/scrollback state is ever torn down
 * just because it's not the one currently in view. When the sidebar is
 * hidden, no extra terminal has been opened, and no files are open (the
 * default), this renders identically to a plain terminal-only SSH tab. */
export function SshWorkspacePanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const session = useSftpStore((s) => s.sessions[tab.id]) ?? DEFAULT_SFTP_SESSION
  const toggleSidebar = useSftpStore((s) => s.toggleSidebar)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL_HEIGHT)
  const [terminalCollapsed, setTerminalCollapsed] = useState(false)

  const sshConfig: SftpConnectionConfig | null =
    tab.connectionConfig.kind === 'ssh'
      ? {
          host: tab.connectionConfig.host,
          port: tab.connectionConfig.port,
          username: tab.connectionConfig.username,
          password: tab.connectionConfig.password,
        }
      : null

  const handleToggleSidebar = () => {
    if (sshConfig) void toggleSidebar(tab.id, sshConfig)
  }

  return (
    <div className="ssh-workspace">
      <div className="ssh-workspace-topbar">
        <button
          type="button"
          className={`icon-button ${session.sidebarVisible ? 'on' : ''}`}
          aria-label={t('ssh.sftp.explorer')}
          title={t('ssh.sftp.explorer')}
          onClick={handleToggleSidebar}
        >
          <FolderIcon />
        </button>
      </div>
      <div className="ssh-workspace-body">
        {session.sidebarVisible && (
          <>
            <div className="ssh-workspace-sidebar" style={{ width: sidebarWidth }}>
              <SftpTreeSidebar tab={tab} />
            </div>
            <SidebarResizer width={sidebarWidth} onChange={setSidebarWidth} />
          </>
        )}
        <div className="ssh-workspace-main">
          <div className="ssh-workspace-editor-area">
            <SftpEditorTabs tab={tab} />
          </div>
          <TerminalDockResizer
            height={terminalCollapsed ? TERMINAL_HEADER_HEIGHT : terminalHeight}
            onChange={(h) => {
              setTerminalCollapsed(false)
              setTerminalHeight(h)
            }}
          />
          <div
            className="ssh-workspace-terminal-dock"
            style={{ height: terminalCollapsed ? TERMINAL_HEADER_HEIGHT : terminalHeight }}
          >
            <div className="terminal-dock-header" onClick={() => setTerminalCollapsed((c) => !c)}>
              <ChevronDownIcon className={terminalCollapsed ? 'collapsed' : ''} />
              <span>{t('ssh.terminal')}</span>
            </div>
            <div
              className="terminal-dock-body"
              style={{ height: terminalCollapsed ? 0 : terminalHeight - TERMINAL_HEADER_HEIGHT }}
            >
              <SshTerminalGroups tab={tab} config={sshConfig} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
