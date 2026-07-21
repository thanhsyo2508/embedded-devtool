import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FtpTreeSidebar } from './FtpTreeSidebar'
import { FtpEditorTabs } from './FtpEditorTabs'
import {
  DEFAULT_FTP_SESSION,
  useFtpTreeStore,
  type FtpConnectionConfig,
} from '../state/ftpTreeStore'
import type { TabState } from '../state/tabsStore'
import { FolderIcon } from './icons'

const MIN_SIDEBAR_WIDTH = 160
const MAX_SIDEBAR_WIDTH = 480
const DEFAULT_SIDEBAR_WIDTH = 240

// Must match FtpTreeSidebar's/FtpEditorTabs' own DRAG_TYPE constants — see
// SshWorkspacePanel's identical catch-all for the full rationale: this sits
// above every inner drop-zone but below PaneContent, so an internal drag
// crossing a gap between zones (the topbar, the sidebar edge, empty space)
// never bubbles up to PaneContent's "split this pane" overlay.
const INTERNAL_DRAG_TYPES = ['application/x-ftp-file', 'application/x-ftp-tree-path']

function isInternalDrag(e: React.DragEvent<HTMLDivElement>): boolean {
  return INTERNAL_DRAG_TYPES.some((type) => e.dataTransfer.types.includes(type))
}

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

/** VSCode-Remote-SSH-style workspace for an FTP tab: a file-tree sidebar and
 * opened remote files as editor tabs (optionally split into two side-by-side
 * groups), mirroring SshWorkspacePanel's SFTP half — minus the terminal
 * dock, since FTP has no PTY/byte-stream side. Unlike SSH+SFTP (two
 * genuinely separate connections), the tab's one FTP control connection is
 * already dialed by `tabsStore.openTab` before this component ever mounts,
 * so `ensureConnected` below only marks the local session live and lists
 * the root — it never dials a second connection. */
export function FtpWorkspacePanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const session = useFtpTreeStore((s) => s.sessions[tab.id]) ?? DEFAULT_FTP_SESSION
  const ensureConnected = useFtpTreeStore((s) => s.ensureConnected)
  const toggleSidebar = useFtpTreeStore((s) => s.toggleSidebar)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)

  const ftpConfig: FtpConnectionConfig | null =
    tab.connectionConfig.kind === 'ftp'
      ? {
          host: tab.connectionConfig.host,
          port: tab.connectionConfig.port,
          username: tab.connectionConfig.username,
          password: tab.connectionConfig.password,
        }
      : null

  useEffect(() => {
    if (ftpConfig) ensureConnected(tab.id, ftpConfig)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  return (
    <div
      className="ssh-workspace"
      onDragOver={(e) => {
        if (!isInternalDrag(e)) return
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        if (!isInternalDrag(e)) return
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="ssh-workspace-topbar">
        <button
          type="button"
          className={`icon-button ${session.sidebarVisible ? 'on' : ''}`}
          aria-label={t('ftp.tree.explorer')}
          title={t('ftp.tree.explorer')}
          onClick={() => toggleSidebar(tab.id)}
        >
          <FolderIcon />
        </button>
      </div>
      <div className="ssh-workspace-body">
        {session.sidebarVisible && (
          <>
            <div className="ssh-workspace-sidebar" style={{ width: sidebarWidth }}>
              <FtpTreeSidebar tab={tab} />
            </div>
            <SidebarResizer width={sidebarWidth} onChange={setSidebarWidth} />
          </>
        )}
        <div className="ssh-workspace-main">
          <div className="ssh-workspace-editor-area">
            <FtpEditorTabs tab={tab} />
          </div>
        </div>
      </div>
    </div>
  )
}
