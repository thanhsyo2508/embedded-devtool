import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open, save } from '@tauri-apps/plugin-dialog'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import type { TabState } from '../state/tabsStore'
import { DEFAULT_FTP_SESSION, formatBytes, useFtpTreeStore } from '../state/ftpTreeStore'
import type { FtpEntry } from '../api/ftp'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { ChevronDownIcon, CodeIcon, FolderIcon, RefreshIcon } from './icons'

const ROOT_PATH = ''

/** dataTransfer type for dragging a tree row — mirrors SftpTreeSidebar's
 * `TREE_DRAG_TYPE`, kept as its own distinct string so an FTP tree drag can
 * never be misread as an SFTP one (or vice versa) if both happen to be open
 * at once. The CSS classes below deliberately reuse `sftp-tree-*`/
 * `sftp-editor-*` (protocol-agnostic layout, not defined per-connection-kind)
 * rather than duplicating a parallel stylesheet. */
export const TREE_DRAG_TYPE = 'application/x-ftp-tree-path'

interface MenuState {
  x: number
  y: number
  parentPath: string
  entry: FtpEntry | null
}

/** Client-side only, over whatever's already been fetched — folders are
 * never hidden by a query (so the tree stays navigable while typing) —
 * only non-matching files get filtered out. */
function filterEntries(entries: FtpEntry[], query: string): FtpEntry[] {
  if (!query) return entries
  return entries.filter((e) => e.isDir || e.name.toLowerCase().includes(query))
}

function TreeRow({
  tab,
  entry,
  depth,
  onMenu,
  filter,
}: {
  tab: TabState
  entry: FtpEntry
  depth: number
  onMenu: (e: React.MouseEvent, parentPath: string, entry: FtpEntry) => void
  filter: string
}) {
  const session = useFtpTreeStore((s) => s.sessions[tab.id]) ?? DEFAULT_FTP_SESSION
  const toggleNode = useFtpTreeStore((s) => s.toggleNode)
  const openFile = useFtpTreeStore((s) => s.openFile)
  const rename = useFtpTreeStore((s) => s.rename)
  const isExpanded = session.expanded.has(entry.path)
  const node = session.nodes[entry.path]
  const children = node?.entries ? filterEntries(node.entries, filter) : null

  return (
    <>
      <div
        className={`sftp-tree-row ${session.groups.some((g) => g.activeFilePath === entry.path) ? 'on' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 6}px` }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(TREE_DRAG_TYPE, entry.path)
          e.dataTransfer.effectAllowed = 'copyMove'
        }}
        onDragOver={(e) => {
          // Only folders are drop targets for a move — dropping a file
          // path onto another file wouldn't mean anything.
          if (!entry.isDir || !e.dataTransfer.types.includes(TREE_DRAG_TYPE)) return
          e.preventDefault()
          e.stopPropagation()
        }}
        onDrop={(e) => {
          if (!entry.isDir || !e.dataTransfer.types.includes(TREE_DRAG_TYPE)) return
          e.preventDefault()
          e.stopPropagation()
          const draggedPath = e.dataTransfer.getData(TREE_DRAG_TYPE)
          if (!draggedPath || draggedPath === entry.path) return
          const name = draggedPath.split('/').pop() ?? draggedPath
          const draggedParent = draggedPath.slice(0, draggedPath.length - name.length - 1)
          // Already directly inside this folder, or being dropped onto
          // itself's own parent by mistake — nothing to do either way.
          if (draggedParent === entry.path) return
          const newPath = entry.path.endsWith('/')
            ? `${entry.path}${name}`
            : `${entry.path}/${name}`
          void rename(tab.id, draggedParent, draggedPath, newPath)
        }}
        onClick={() => {
          if (entry.isDir) void toggleNode(tab.id, entry.path)
          else void openFile(tab.id, entry)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          // Without this, the event bubbles to the sidebar's own
          // onContextMenu (below), which fires right after and overwrites
          // this row's entry-specific menu with the generic root one.
          e.stopPropagation()
          onMenu(e, entry.path.slice(0, entry.path.length - entry.name.length - 1), entry)
        }}
      >
        {entry.isDir ? (
          <span className={`sftp-tree-toggle ${isExpanded ? 'open' : ''}`}>
            <ChevronDownIcon />
          </span>
        ) : (
          <span className="sftp-tree-toggle sftp-tree-toggle-spacer" />
        )}
        {entry.isDir ? <FolderIcon /> : <CodeIcon />}
        <span className="sftp-tree-name">{entry.name}</span>
        {node?.loading && <span className="sftp-tree-loading" />}
      </div>
      {entry.isDir && isExpanded && children && (
        <>
          {node?.error && <div className="sftp-tree-error">{node.error}</div>}
          {children.map((child) => (
            <TreeRow
              key={child.path}
              tab={tab}
              entry={child}
              depth={depth + 1}
              onMenu={onMenu}
              filter={filter}
            />
          ))}
        </>
      )}
    </>
  )
}

export function FtpTreeSidebar({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const session = useFtpTreeStore((s) => s.sessions[tab.id]) ?? DEFAULT_FTP_SESSION
  const refreshNode = useFtpTreeStore((s) => s.refreshNode)
  const reconnect = useFtpTreeStore((s) => s.reconnect)
  const mkdir = useFtpTreeStore((s) => s.mkdir)
  const rename = useFtpTreeStore((s) => s.rename)
  const deleteEntry = useFtpTreeStore((s) => s.deleteEntry)
  const uploadLocalFile = useFtpTreeStore((s) => s.uploadLocalFile)
  const uploadBytes = useFtpTreeStore((s) => s.uploadBytes)
  const downloadFile = useFtpTreeStore((s) => s.downloadFile)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [query, setQuery] = useState('')

  const rootNode = session.nodes[ROOT_PATH]
  const filter = query.trim().toLowerCase()
  const rootEntries = rootNode?.entries ? filterEntries(rootNode.entries, filter) : null

  const openMenu = (e: React.MouseEvent, parentPath: string, entry: FtpEntry | null) => {
    setMenu({ x: e.clientX, y: e.clientY, parentPath, entry })
  }

  const menuItems = (): ContextMenuItem[] => {
    if (!menu) return []
    const targetDir = menu.entry?.isDir ? menu.entry.path : menu.parentPath
    const items: ContextMenuItem[] = [
      {
        label: t('ftp.tree.newFile'),
        onClick: () => {
          const name = window.prompt(t('ftp.tree.newFilePrompt'))
          if (name) void uploadBytes(tab.id, targetDir, name, [])
        },
      },
      {
        label: t('ftp.tree.newFolder'),
        onClick: () => {
          const name = window.prompt(t('ftp.tree.newFolderPrompt'))
          if (name) void mkdir(tab.id, targetDir, name)
        },
      },
      {
        label: t('ftp.tree.upload'),
        onClick: () => {
          void open({ multiple: false }).then((picked) => {
            if (typeof picked === 'string') void uploadLocalFile(tab.id, targetDir, picked)
          })
        },
      },
      { label: t('ftp.tree.refresh'), onClick: () => void refreshNode(tab.id, targetDir) },
    ]
    if (menu.entry) {
      items.push(
        {
          label: t('ftp.tree.rename'),
          separatorBefore: true,
          onClick: () => {
            const to = window.prompt(t('ftp.tree.renamePrompt'), menu.entry!.name)
            if (to && to !== menu.entry!.name) {
              void rename(tab.id, menu.parentPath, menu.entry!.path, `${menu.parentPath}/${to}`)
            }
          },
        },
        {
          label: t('ftp.tree.delete'),
          onClick: () => {
            if (window.confirm(t('ftp.tree.deleteConfirm', { name: menu.entry!.name }))) {
              void deleteEntry(tab.id, menu.parentPath, menu.entry!)
            }
          },
        },
        {
          label: t('ftp.tree.copyPath'),
          onClick: () => void writeText(menu.entry!.path),
        },
      )
      if (!menu.entry.isDir) {
        items.push({
          label: t('ftp.tree.download'),
          onClick: () => {
            void save({ defaultPath: menu.entry!.name }).then((path) => {
              if (path) void downloadFile(tab.id, menu.entry!, path)
            })
          },
        })
      }
    }
    return items
  }

  const handleDragOver = (e: React.DragEvent) => {
    // Only claim OS-file drags here — an internal tree-row drag carries no
    // 'Files' type, so this leaves that alone.
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDragOver(true)
  }

  const handleDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    for (const file of files) {
      void file.arrayBuffer().then((buf) => {
        void uploadBytes(tab.id, ROOT_PATH, file.name, Array.from(new Uint8Array(buf)))
      })
    }
  }

  return (
    <div
      className={`sftp-tree-sidebar ${dragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu(e, ROOT_PATH, null)
      }}
    >
      <div className="sftp-tree-header">
        <span>{t('ftp.tree.explorer')}</span>
        <button
          type="button"
          className="icon-button"
          aria-label={t('ftp.tree.refresh')}
          onClick={() => void refreshNode(tab.id, ROOT_PATH)}
        >
          <RefreshIcon />
        </button>
      </div>
      {session.transferProgress && (
        <div className="sftp-tree-transfer">
          <div className="sftp-tree-transfer-label">
            {t(
              session.transferProgress.operation === 'upload'
                ? 'ftp.tree.uploading'
                : 'ftp.tree.downloading',
            )}{' '}
            {session.transferProgress.total > 0
              ? `${Math.round((session.transferProgress.transferred / session.transferProgress.total) * 100)}%`
              : formatBytes(session.transferProgress.transferred)}
          </div>
          <div className="sftp-tree-transfer-bar">
            <div
              className="sftp-tree-transfer-fill"
              style={{
                width:
                  session.transferProgress.total > 0
                    ? `${Math.min(100, (session.transferProgress.transferred / session.transferProgress.total) * 100)}%`
                    : '100%',
              }}
            />
          </div>
        </div>
      )}
      {session.connected && (
        <input
          type="text"
          className="sftp-tree-search"
          placeholder={t('ftp.tree.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {session.connecting && <p className="sftp-tree-status">{t('ftp.tree.connecting')}</p>}
      {session.connectError && (
        <div className="sftp-tree-status">
          <p className="connect-error">{session.connectError}</p>
          {session.config && (
            <button
              type="button"
              className="connect-button"
              disabled={session.connecting}
              onClick={() => void reconnect(tab.id)}
            >
              <RefreshIcon /> {t('ftp.tree.reconnect')}
            </button>
          )}
        </div>
      )}
      {session.connected && rootEntries && (
        <div className="sftp-tree-body">
          {rootEntries.map((entry) => (
            <TreeRow
              key={entry.path}
              tab={tab}
              entry={entry}
              depth={0}
              onMenu={openMenu}
              filter={filter}
            />
          ))}
        </div>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
