import { Fragment, useEffect, useRef, useState } from 'react'
import Editor from 'react-simple-code-editor'
import { useTranslation } from 'react-i18next'
import { useTabsStore, type TabState } from '../state/tabsStore'
import {
  DEFAULT_FTP_SESSION,
  useFtpTreeStore,
  type FtpEditorGroup,
  type OpenFtpFile,
} from '../state/ftpTreeStore'
import { highlightForPath } from '../lib/sftpFileLanguage'
import { EditorFindBar, type EditorMatch } from './EditorFindBar'
import { DiskIcon, SearchIcon, SplitIcon, XIcon } from './icons'

const MIN_GROUP_WIDTH = 240
const DEFAULT_GROUP_WIDTH = 420

// Mirrors SftpEditorTabs' `DRAG_TYPE` — its own distinct dataTransfer type
// so a drag started here is invisible to both the outer pane-split system
// (which only reads 'text/plain') and to an SFTP editor's own drag handlers
// (a different type string), and vice versa.
const DRAG_TYPE = 'application/x-ftp-file'

interface DragPayload {
  groupId: string
  path: string
}

function computeLineCol(content: string, pos: number): { line: number; col: number } {
  const before = content.slice(0, pos)
  const lines = before.split('\n')
  return { line: lines.length, col: lines[lines.length - 1].length + 1 }
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
  group: FtpEditorGroup
  openFiles: OpenFtpFile[]
  isFocused: boolean
  canSplit: boolean
  canClose: boolean
  showSplitZone: boolean
  onTabDragStart: () => void
  onTabDragEnd: () => void
}) {
  const { t } = useTranslation()
  const closeFile = useFtpTreeStore((s) => s.closeFile)
  const setActiveFile = useFtpTreeStore((s) => s.setActiveFile)
  const setActiveGroup = useFtpTreeStore((s) => s.setActiveGroup)
  const setFileContent = useFtpTreeStore((s) => s.setFileContent)
  const saveFile = useFtpTreeStore((s) => s.saveFile)
  const splitGroupRight = useFtpTreeStore((s) => s.splitGroupRight)
  const moveFileToGroup = useFtpTreeStore((s) => s.moveFileToGroup)
  const closeGroup = useFtpTreeStore((s) => s.closeGroup)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const [wordWrap, setWordWrap] = useState(false)
  const [showFind, setShowFind] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number | undefined>(undefined)
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 })
  const editorWrapRef = useRef<HTMLDivElement>(null)

  const files = group.filePaths
    .map((path) => openFiles.find((f) => f.path === path))
    .filter((f): f is OpenFtpFile => f !== undefined)
  const activeFile = files.find((f) => f.path === group.activeFilePath) ?? null

  // Resets the cursor readout and closes any open find bar the moment the
  // active file changes — adjusted during render rather than in an effect,
  // per React's guidance for resetting state derived from a changed value.
  const [trackedFilePath, setTrackedFilePath] = useState(activeFile?.path)
  if (activeFile?.path !== trackedFilePath) {
    setTrackedFilePath(activeFile?.path)
    setCursorPos({ line: 1, col: 1 })
    setShowFind(false)
    setFindQuery('')
    setCurrentMatchIndex(undefined)
  }

  useEffect(() => {
    if (!activeFile || !isFocused) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTabId !== tab.id) return
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void saveFile(tab.id, activeFile.path)
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setShowFind(true)
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
    // A move to a *different* group unmounts the dragged tab's own DOM node,
    // so the browser can drop the native drag operation without ever firing
    // dragend on it — resetting the drag state here too (not just from the
    // tab's own onDragEnd) covers that case. Same fix as SftpEditorTabs.
    onTabDragEnd()
    const raw = e.dataTransfer.getData(DRAG_TYPE)
    if (!raw) return
    const payload = JSON.parse(raw) as DragPayload
    if (payload.groupId !== group.id)
      moveFileToGroup(tab.id, payload.path, payload.groupId, group.id)
  }

  const jumpToMatch = (match: EditorMatch) => {
    if (!activeFile) return
    const textarea = editorWrapRef.current?.querySelector('textarea')
    const wrap = editorWrapRef.current
    if (!textarea || !wrap) return
    // Deliberately does NOT call textarea.focus() — this runs on every
    // keystroke in the find bar (see EditorFindBar's jump-on-match-change
    // effect), and focusing the textarea would yank focus out of the find
    // bar's own input after the very first character, making it impossible
    // to type a query longer than one character. setSelectionRange still
    // marks the match on the (unfocused) textarea — browsers render an
    // unfocused selection with a dimmer highlight, which is enough to see
    // where the match is without stealing keystrokes.
    textarea.setSelectionRange(match.start, match.end)
    const lineIndex = activeFile.content.slice(0, match.start).split('\n').length - 1
    const style = getComputedStyle(textarea)
    const lineHeight = parseFloat(style.lineHeight) || 18
    const paddingTop = parseFloat(style.paddingTop) || 0
    const targetTop = paddingTop + lineIndex * lineHeight
    wrap.scrollTop = Math.max(0, targetTop - wrap.clientHeight / 2)
  }

  const lineCount = activeFile ? activeFile.content.split('\n').length : 1

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
                    !window.confirm(t('ftp.tree.closeUnsavedConfirm', { name: file.name }))
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
            aria-label={t('ftp.tree.closeGroup')}
            title={t('ftp.tree.closeGroup')}
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
              {!activeFile.isBinary && (
                <span className="sftp-editor-cursor-pos">
                  {t('ftp.tree.cursorPos', { line: cursorPos.line, col: cursorPos.col })}
                </span>
              )}
              {!activeFile.isBinary && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('ftp.tree.findInFile')}
                  title={t('ftp.tree.findInFile')}
                  onClick={() => setShowFind(true)}
                >
                  <SearchIcon />
                </button>
              )}
              {!activeFile.isBinary && (
                <button
                  type="button"
                  className={`icon-button text-toggle ${wordWrap ? 'on' : ''}`}
                  aria-label={t('ftp.tree.wordWrap')}
                  title={t('ftp.tree.wordWrap')}
                  onClick={() => setWordWrap((w) => !w)}
                >
                  {t('ftp.tree.wordWrapShort')}
                </button>
              )}
              {canSplit && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('ftp.tree.splitRight')}
                  title={t('ftp.tree.splitRight')}
                  onClick={() => splitGroupRight(tab.id, activeFile.path)}
                >
                  <SplitIcon />
                </button>
              )}
              {!activeFile.isBinary && (
                <button
                  type="button"
                  className="connect-button"
                  disabled={activeFile.saving || activeFile.content === activeFile.originalContent}
                  onClick={() => void saveFile(tab.id, activeFile.path)}
                >
                  <DiskIcon /> {t('ftp.tree.save')}
                </button>
              )}
            </div>
          </div>
          {activeFile.error && <p className="connect-error">{activeFile.error}</p>}
          {activeFile.loading ? (
            <div className="sftp-editor-loading">{t('ftp.tree.connecting')}</div>
          ) : activeFile.isBinary ? (
            <div className="sftp-editor-binary-notice">{t('ftp.tree.binaryFile')}</div>
          ) : (
            <div className="sftp-code-editor-wrap" ref={editorWrapRef}>
              {!wordWrap && (
                <div className="sftp-code-editor-gutter">
                  {Array.from({ length: lineCount }, (_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
              )}
              <Editor
                className={`sftp-code-editor ${wordWrap ? 'wrap-lines' : ''}`}
                value={activeFile.content}
                onValueChange={(code) => setFileContent(tab.id, activeFile.path, code)}
                highlight={(code) =>
                  highlightForPath(
                    activeFile.path,
                    code,
                    showFind ? findQuery : undefined,
                    showFind ? currentMatchIndex : undefined,
                  )
                }
                padding={10}
                tabSize={2}
                disabled={activeFile.saving}
                onClick={(e) => {
                  const target = e.currentTarget as HTMLTextAreaElement
                  setCursorPos(computeLineCol(activeFile.content, target.selectionStart))
                }}
                onKeyUp={(e) => {
                  const target = e.currentTarget as HTMLTextAreaElement
                  setCursorPos(computeLineCol(activeFile.content, target.selectionStart))
                }}
              />
              {showFind && (
                <EditorFindBar
                  content={activeFile.content}
                  placeholder={t('ftp.tree.findInFile')}
                  onJump={jumpToMatch}
                  onQueryChange={setFindQuery}
                  onCurrentIndexChange={setCurrentMatchIndex}
                  onClose={() => {
                    setShowFind(false)
                    setFindQuery('')
                    setCurrentMatchIndex(undefined)
                  }}
                />
              )}
            </div>
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
            onTabDragEnd()
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

export function FtpEditorTabs({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const session = useFtpTreeStore((s) => s.sessions[tab.id]) ?? DEFAULT_FTP_SESSION
  const saveAllFiles = useFtpTreeStore((s) => s.saveAllFiles)
  const [savingAll, setSavingAll] = useState(false)
  const [firstGroupWidth, setFirstGroupWidth] = useState(DEFAULT_GROUP_WIDTH)
  const [isDraggingTab, setIsDraggingTab] = useState(false)

  if (session.openFiles.length === 0) {
    return <div className="sftp-editor-empty">{t('ftp.tree.noFileOpen')}</div>
  }

  const dirtyFiles = session.openFiles.filter((f) => !f.isBinary && f.content !== f.originalContent)
  const canSplit = session.groups.length < 2

  return (
    <>
      {dirtyFiles.length > 1 && (
        <div className="sftp-editor-saveall-bar">
          <button
            type="button"
            className="icon-button text-toggle"
            disabled={savingAll}
            onClick={() => {
              setSavingAll(true)
              void saveAllFiles(tab.id).finally(() => setSavingAll(false))
            }}
          >
            <DiskIcon /> {t('ftp.tree.saveAll', { count: dirtyFiles.length })}
          </button>
        </div>
      )}
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
    </>
  )
}
