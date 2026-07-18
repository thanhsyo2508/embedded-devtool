import { Fragment, useEffect, useRef, useState } from 'react'
import Editor from 'react-simple-code-editor'
import { useTranslation } from 'react-i18next'
import { useTabsStore, type TabState } from '../state/tabsStore'
import {
  DEFAULT_SFTP_SESSION,
  useSftpStore,
  type OpenSftpFile,
  type SftpEditorGroup,
} from '../state/sftpStore'
import { highlightForPath } from '../lib/sftpFileLanguage'
import { DiskIcon, SplitIcon, XIcon } from './icons'

const MIN_GROUP_WIDTH = 240
const DEFAULT_GROUP_WIDTH = 420

// A custom dataTransfer type, distinct from TabStrip's/PaneContent's plain
// 'text/plain' tab-id payload (see App.css's SplitResizer-adjacent comment
// in PaneContent.tsx) — using our own type means a drag started here is
// invisible to the outer connection-tab-strip/pane-split drop handlers
// (they only read 'text/plain', which we never set), and vice versa: an
// outer tab drag never matches our own onDragOver/onDrop type checks below.
// Every one of our own drag handlers also calls stopPropagation() once it
// recognizes this type, so the drag never bubbles up to PaneContent's
// pane-body listener and flashes its "drop to split pane" overlay while the
// user is just rearranging file tabs inside one SSH tab's editor area.
const DRAG_TYPE = 'application/x-sftp-file'

interface DragPayload {
  groupId: string
  path: string
}

function GroupResizer({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  const dragStart = useRef<{ x: number; width: number } | null>(null)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = { x: e.clientX, width }
    const handleMove = (moveEvent: PointerEvent) => {
      if (!dragStart.current) return
      const delta = moveEvent.clientX - dragStart.current.x
      onChange(Math.max(MIN_GROUP_WIDTH, dragStart.current.width + delta))
    }
    const handleUp = () => {
      dragStart.current = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  return <div className="sftp-editor-group-resizer" onPointerDown={handlePointerDown} />
}

function EditorGroupPane({
  tab,
  group,
  openFiles,
  isFocused,
  canSplit,
  canClose,
  showSplitZone,
  onTabDragStart,
  onTabDragEnd,
}: {
  tab: TabState
  group: SftpEditorGroup
  openFiles: OpenSftpFile[]
  isFocused: boolean
  canSplit: boolean
  canClose: boolean
  showSplitZone: boolean
  onTabDragStart: () => void
  onTabDragEnd: () => void
}) {
  const { t } = useTranslation()
  const closeFile = useSftpStore((s) => s.closeFile)
  const setActiveFile = useSftpStore((s) => s.setActiveFile)
  const setActiveGroup = useSftpStore((s) => s.setActiveGroup)
  const setFileContent = useSftpStore((s) => s.setFileContent)
  const saveFile = useSftpStore((s) => s.saveFile)
  const splitGroupRight = useSftpStore((s) => s.splitGroupRight)
  const moveFileToGroup = useSftpStore((s) => s.moveFileToGroup)
  const closeGroup = useSftpStore((s) => s.closeGroup)
  const activeTabId = useTabsStore((s) => s.activeTabId)

  const files = group.filePaths
    .map((path) => openFiles.find((f) => f.path === path))
    .filter((f): f is OpenSftpFile => f !== undefined)
  const activeFile = files.find((f) => f.path === group.activeFilePath) ?? null

  useEffect(() => {
    if (!activeFile || !isFocused) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTabId !== tab.id) return
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void saveFile(tab.id, activeFile.path)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeFile, isFocused, activeTabId, tab.id, saveFile])

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    e.stopPropagation()
    const raw = e.dataTransfer.getData(DRAG_TYPE)
    if (!raw) return
    const payload = JSON.parse(raw) as DragPayload
    if (payload.groupId !== group.id)
      moveFileToGroup(tab.id, payload.path, payload.groupId, group.id)
  }

  return (
    <div
      className={`sftp-editor-group ${isFocused ? 'on' : ''}`}
      onFocus={() => setActiveGroup(tab.id, group.id)}
      onClick={() => setActiveGroup(tab.id, group.id)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="sftp-editor-tabstrip">
        {files.map((file) => {
          const dirty = file.content !== file.originalContent
          return (
            <div
              key={file.path}
              className={`sftp-editor-tab ${group.activeFilePath === file.path ? 'on' : ''}`}
              draggable
              onClick={() => setActiveFile(tab.id, group.id, file.path)}
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  DRAG_TYPE,
                  JSON.stringify({ groupId: group.id, path: file.path } satisfies DragPayload),
                )
                e.dataTransfer.effectAllowed = 'move'
                e.stopPropagation()
                onTabDragStart()
              }}
              onDragEnd={onTabDragEnd}
            >
              {dirty && <span className="sftp-editor-dirty-dot" />}
              <span className="tab-label">{file.name}</span>
              <button
                type="button"
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  if (
                    dirty &&
                    !window.confirm(t('ssh.sftp.closeUnsavedConfirm', { name: file.name }))
                  ) {
                    return
                  }
                  closeFile(tab.id, group.id, file.path)
                }}
              >
                <XIcon />
              </button>
            </div>
          )
        })}
        {canClose && (
          <button
            type="button"
            className="icon-button sftp-editor-group-close"
            aria-label={t('ssh.sftp.closeGroup')}
            title={t('ssh.sftp.closeGroup')}
            onClick={() => closeGroup(tab.id, group.id)}
          >
            <XIcon />
          </button>
        )}
      </div>
      {activeFile && (
        <div className="sftp-editor-body">
          <div className="sftp-editor-toolbar">
            <span className="mono">{activeFile.path}</span>
            <div className="sftp-editor-toolbar-actions">
              {canSplit && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('ssh.sftp.splitRight')}
                  title={t('ssh.sftp.splitRight')}
                  onClick={() => splitGroupRight(tab.id, activeFile.path)}
                >
                  <SplitIcon />
                </button>
              )}
              <button
                type="button"
                className="connect-button"
                disabled={activeFile.saving || activeFile.content === activeFile.originalContent}
                onClick={() => void saveFile(tab.id, activeFile.path)}
              >
                <DiskIcon /> {t('ssh.sftp.save')}
              </button>
            </div>
          </div>
          {activeFile.error && <p className="connect-error">{activeFile.error}</p>}
          {activeFile.loading ? (
            <div className="sftp-editor-loading">{t('ssh.sftp.connecting')}</div>
          ) : (
            <Editor
              className="sftp-code-editor"
              style={{ overflow: 'auto' }}
              value={activeFile.content}
              onValueChange={(code) => setFileContent(tab.id, activeFile.path, code)}
              highlight={(code) => highlightForPath(activeFile.path, code)}
              padding={10}
              tabSize={2}
              disabled={activeFile.saving}
            />
          )}
        </div>
      )}
      {showSplitZone && (
        <div
          className="sftp-editor-split-zone"
          onDragOver={handleDragOver}
          onDrop={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
            e.preventDefault()
            e.stopPropagation()
            const raw = e.dataTransfer.getData(DRAG_TYPE)
            if (!raw) return
            const payload = JSON.parse(raw) as DragPayload
            splitGroupRight(tab.id, payload.path)
          }}
        />
      )}
    </div>
  )
}

export function SftpEditorTabs({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const session = useSftpStore((s) => s.sessions[tab.id]) ?? DEFAULT_SFTP_SESSION
  const [firstGroupWidth, setFirstGroupWidth] = useState(DEFAULT_GROUP_WIDTH)
  const [isDraggingTab, setIsDraggingTab] = useState(false)

  if (session.openFiles.length === 0) {
    return <div className="sftp-editor-empty">{t('ssh.sftp.noFileOpen')}</div>
  }

  const canSplit = session.groups.length < 2

  return (
    <div className="sftp-editor-groups">
      {session.groups.map((group, i) => (
        <Fragment key={group.id}>
          {i > 0 && <GroupResizer width={firstGroupWidth} onChange={setFirstGroupWidth} />}
          <div
            className="sftp-editor-group-slot"
            style={
              session.groups.length > 1 && i === 0
                ? { width: firstGroupWidth, flex: 'none' }
                : { flex: 1 }
            }
          >
            <EditorGroupPane
              tab={tab}
              group={group}
              openFiles={session.openFiles}
              isFocused={session.activeGroupId === group.id}
              canSplit={canSplit && i === session.groups.length - 1}
              canClose={session.groups.length > 1}
              showSplitZone={isDraggingTab && session.groups.length === 1}
              onTabDragStart={() => setIsDraggingTab(true)}
              onTabDragEnd={() => setIsDraggingTab(false)}
            />
          </div>
        </Fragment>
      ))}
    </div>
  )
}
