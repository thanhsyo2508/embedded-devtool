import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import type { TabState } from '../state/tabsStore'
import { DEFAULT_SFTP_SESSION, useSftpStore } from '../state/sftpStore'
import type { SftpEntry } from '../api/sftp'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { ChevronDownIcon, CodeIcon, FolderIcon, RefreshIcon } from './icons'

const ROOT_PATH = ''

interface MenuState {
  x: number
  y: number
  parentPath: string
  entry: SftpEntry | null
}

function TreeRow({
  tab,
  entry,
  depth,
  onMenu,
}: {
  tab: TabState
  entry: SftpEntry
  depth: number
  onMenu: (e: React.MouseEvent, parentPath: string, entry: SftpEntry) => void
}) {
  const session = useSftpStore((s) => s.sessions[tab.id]) ?? DEFAULT_SFTP_SESSION
  const toggleNode = useSftpStore((s) => s.toggleNode)
  const openFile = useSftpStore((s) => s.openFile)
  const isExpanded = session.expanded.has(entry.path)
  const node = session.nodes[entry.path]

  return (
    <>
      <div
        className={`sftp-tree-row ${session.groups.some((g) => g.activeFilePath === entry.path) ? 'on' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 6}px` }}
        onClick={() => {
          if (entry.isDir) void toggleNode(tab.id, entry.path)
          else void openFile(tab.id, entry)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
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
      {entry.isDir && isExpanded && node?.entries && (
        <>
          {node.error && <div className="sftp-tree-error">{node.error}</div>}
          {node.entries.map((child) => (
            <TreeRow key={child.path} tab={tab} entry={child} depth={depth + 1} onMenu={onMenu} />
          ))}
        </>
      )}
    </>
  )
}

export function SftpTreeSidebar({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const session = useSftpStore((s) => s.sessions[tab.id]) ?? DEFAULT_SFTP_SESSION
  const refreshNode = useSftpStore((s) => s.refreshNode)
  const mkdir = useSftpStore((s) => s.mkdir)
  const rename = useSftpStore((s) => s.rename)
  const deleteEntry = useSftpStore((s) => s.deleteEntry)
  const uploadLocalFile = useSftpStore((s) => s.uploadLocalFile)
  const uploadBytes = useSftpStore((s) => s.uploadBytes)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const rootNode = session.nodes[ROOT_PATH]

  const openMenu = (e: React.MouseEvent, parentPath: string, entry: SftpEntry | null) => {
    setMenu({ x: e.clientX, y: e.clientY, parentPath, entry })
  }

  const menuItems = (): ContextMenuItem[] => {
    if (!menu) return []
    const targetDir = menu.entry?.isDir ? menu.entry.path : menu.parentPath
    const items: ContextMenuItem[] = [
      {
        label: t('ssh.sftp.newFile'),
        onClick: () => {
          const name = window.prompt(t('ssh.sftp.newFilePrompt'))
          if (name) void uploadBytes(tab.id, targetDir, name, [])
        },
      },
      {
        label: t('ssh.sftp.newFolder'),
        onClick: () => {
          const name = window.prompt(t('ssh.sftp.newFolderPrompt'))
          if (name) void mkdir(tab.id, targetDir, name)
        },
      },
      {
        label: t('ssh.sftp.upload'),
        onClick: () => {
          void open({ multiple: false }).then((picked) => {
            if (typeof picked === 'string') void uploadLocalFile(tab.id, targetDir, picked)
          })
        },
      },
      { label: t('ssh.sftp.refresh'), onClick: () => void refreshNode(tab.id, targetDir) },
    ]
    if (menu.entry) {
      items.push(
        {
          label: t('ssh.sftp.rename'),
          separatorBefore: true,
          onClick: () => {
            const to = window.prompt(t('ssh.sftp.renamePrompt'), menu.entry!.name)
            if (to && to !== menu.entry!.name) {
              void rename(tab.id, menu.parentPath, menu.entry!.path, `${menu.parentPath}/${to}`)
            }
          },
        },
        {
          label: t('ssh.sftp.delete'),
          onClick: () => {
            if (window.confirm(t('ssh.sftp.deleteConfirm', { name: menu.entry!.name }))) {
              void deleteEntry(tab.id, menu.parentPath, menu.entry!)
            }
          },
        },
      )
    }
    return items
  }

  const handleDrop = (e: React.DragEvent) => {
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
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu(e, ROOT_PATH, null)
      }}
    >
      <div className="sftp-tree-header">
        <span>{t('ssh.sftp.explorer')}</span>
        <button
          type="button"
          className="icon-button"
          aria-label={t('ssh.sftp.refresh')}
          onClick={() => void refreshNode(tab.id, ROOT_PATH)}
        >
          <RefreshIcon />
        </button>
      </div>
      {session.connecting && <p className="sftp-tree-status">{t('ssh.sftp.connecting')}</p>}
      {session.connectError && <p className="connect-error">{session.connectError}</p>}
      {session.connected && rootNode?.entries && (
        <div className="sftp-tree-body">
          {rootNode.entries.map((entry) => (
            <TreeRow key={entry.path} tab={tab} entry={entry} depth={0} onMenu={openMenu} />
          ))}
        </div>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}
