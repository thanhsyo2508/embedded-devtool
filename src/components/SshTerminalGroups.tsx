import { Fragment, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SshPanel } from './SshPanel'
import { SshExtraTerminal } from './SshExtraTerminal'
import {
  fallbackTerminalGroups,
  useSshTerminalsStore,
  type SshConnectionConfig,
  type TerminalGroup,
} from '../state/sshTerminalsStore'
import type { TabState } from '../state/tabsStore'
import { PlusIcon, SplitIcon, XIcon } from './icons'

const MIN_GROUP_WIDTH = 200
const DEFAULT_GROUP_WIDTH = 360

// Distinct dataTransfer type from SftpEditorTabs' own DRAG_TYPE (different
// payload shape — a terminal id, not a file path — and keeping the two
// drag systems' types separate means one's drop handler can never
// misinterpret the other's JSON). Same non-interference reasoning as
// SftpEditorTabs' own DRAG_TYPE comment: our own type is invisible to the
// outer TabStrip/PaneContent drag system (which only reads 'text/plain'),
// and vice versa.
const DRAG_TYPE = 'application/x-ssh-terminal'

interface DragPayload {
  groupId: string
  terminalId: string
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

function TerminalGroupPane({
  tab,
  group,
  config,
  isFocused,
  canSplit,
  canClose,
  showSplitZone,
  onDragStartAny,
  onDragEndAny,
}: {
  tab: TabState
  group: TerminalGroup
  config: SshConnectionConfig | null
  isFocused: boolean
  canSplit: boolean
  canClose: boolean
  showSplitZone: boolean
  onDragStartAny: () => void
  onDragEndAny: () => void
}) {
  const { t } = useTranslation()
  const setActiveGroup = useSshTerminalsStore((s) => s.setActiveGroup)
  const setActiveTerminal = useSshTerminalsStore((s) => s.setActiveTerminal)
  const closeTerminal = useSshTerminalsStore((s) => s.closeTerminal)
  const addTerminal = useSshTerminalsStore((s) => s.addTerminal)
  const splitGroupRight = useSshTerminalsStore((s) => s.splitGroupRight)
  const moveTerminalToGroup = useSshTerminalsStore((s) => s.moveTerminalToGroup)
  const closeGroup = useSshTerminalsStore((s) => s.closeGroup)
  const terminalNumbers = useSshTerminalsStore((s) => s.terminalNumbers)

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
    e.preventDefault()
    e.stopPropagation()
    // A move to a *different* group unmounts the dragged tab's own DOM node
    // (it's rendered by that group's own map(), so React tears it down and
    // mounts a new one in the target group instead of moving the existing
    // node) — the browser can then drop the native drag operation without
    // ever firing dragend on it, which would otherwise leave onDragEndAny
    // uncalled and the drag state (and its split-zone overlay) stuck "in
    // progress" forever. Resetting it here too, not just from the tab's own
    // onDragEnd, covers that case.
    onDragEndAny()
    const raw = e.dataTransfer.getData(DRAG_TYPE)
    if (!raw) return
    const payload = JSON.parse(raw) as DragPayload
    if (payload.groupId !== group.id) {
      moveTerminalToGroup(tab.id, payload.terminalId, payload.groupId, group.id)
    }
  }

  return (
    <div
      className={`sftp-editor-group ${isFocused ? 'on' : ''}`}
      onClick={() => setActiveGroup(tab.id, group.id)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="terminal-tabstrip">
        {group.terminalIds.map((id, i) => {
          const isPrimary = id === tab.id
          return (
            <div
              key={id}
              className={`terminal-tab ${group.activeTerminalId === id ? 'on' : ''}`}
              draggable
              onClick={() => setActiveTerminal(tab.id, group.id, id)}
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  DRAG_TYPE,
                  JSON.stringify({ groupId: group.id, terminalId: id } satisfies DragPayload),
                )
                e.dataTransfer.effectAllowed = 'move'
                e.stopPropagation()
                onDragStartAny()
              }}
              onDragEnd={onDragEndAny}
            >
              <span className="tab-label">
                {isPrimary
                  ? t('ssh.terminal')
                  : t('ssh.terminalN', { n: terminalNumbers[id] ?? i + 1 })}
              </span>
              {!isPrimary && (
                <button
                  type="button"
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    void closeTerminal(tab.id, group.id, id)
                  }}
                >
                  <XIcon />
                </button>
              )}
            </div>
          )
        })}
        <button
          type="button"
          className="icon-button terminal-tabstrip-add"
          aria-label={t('ssh.addTerminal')}
          title={t('ssh.addTerminal')}
          onClick={(e) => {
            e.stopPropagation()
            if (config) void addTerminal(tab.id, config, group.id)
          }}
        >
          <PlusIcon />
        </button>
        {canSplit && (
          <button
            type="button"
            className="icon-button"
            aria-label={t('ssh.sftp.splitRight')}
            title={t('ssh.sftp.splitRight')}
            onClick={(e) => {
              e.stopPropagation()
              if (group.activeTerminalId) splitGroupRight(tab.id, group.activeTerminalId)
            }}
          >
            <SplitIcon />
          </button>
        )}
        {canClose && (
          <button
            type="button"
            className="icon-button sftp-editor-group-close"
            aria-label={t('ssh.sftp.closeGroup')}
            title={t('ssh.sftp.closeGroup')}
            onClick={(e) => {
              e.stopPropagation()
              void closeGroup(tab.id, group.id)
            }}
          >
            <XIcon />
          </button>
        )}
      </div>
      <div className="terminal-group-body">
        {group.terminalIds.map((id) => (
          <div
            key={id}
            style={{ display: group.activeTerminalId === id ? 'flex' : 'none', height: '100%' }}
          >
            {id === tab.id ? (
              <SshPanel tab={tab} />
            ) : (
              <SshExtraTerminal tabId={tab.id} terminalId={id} />
            )}
          </div>
        ))}
      </div>
      {showSplitZone && (
        <div
          className="sftp-editor-split-zone"
          onDragOver={handleDragOver}
          onDrop={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
            e.preventDefault()
            e.stopPropagation()
            onDragEndAny()
            const raw = e.dataTransfer.getData(DRAG_TYPE)
            if (!raw) return
            const payload = JSON.parse(raw) as DragPayload
            splitGroupRight(tab.id, payload.terminalId)
          }}
        />
      )}
    </div>
  )
}

/** Terminal-dock analog of SftpEditorTabs: one or two side-by-side terminal
 * groups (VSCode-style Split Right), each with its own tab strip. The tab's
 * own default terminal always starts in group 1 and renders via the
 * existing, unmodified SshPanel; every other terminal is an SshExtraTerminal
 * (see that file's module doc for why it's a separate connection). Every
 * terminal in every group renders unconditionally, always mounted — hiding
 * one is pure CSS, so no terminal's PTY/scrollback is ever torn down just
 * because it's not the one currently in view. */
export function SshTerminalGroups({
  tab,
  config,
}: {
  tab: TabState
  config: SshConnectionConfig | null
}) {
  const fallback = useMemo(() => fallbackTerminalGroups(tab.id), [tab.id])
  const groups = useSshTerminalsStore((s) => s.groups[tab.id]) ?? fallback
  const activeGroupId = useSshTerminalsStore((s) => s.activeGroupId[tab.id]) ?? groups[0].id
  const [firstGroupWidth, setFirstGroupWidth] = useState(DEFAULT_GROUP_WIDTH)
  const [isDraggingTerminal, setIsDraggingTerminal] = useState(false)

  const canSplit = groups.length < 2

  return (
    <div className="sftp-editor-groups">
      {groups.map((group, i) => (
        <Fragment key={group.id}>
          {i > 0 && <GroupResizer width={firstGroupWidth} onChange={setFirstGroupWidth} />}
          <div
            className="sftp-editor-group-slot"
            style={
              groups.length > 1 && i === 0 ? { width: firstGroupWidth, flex: 'none' } : { flex: 1 }
            }
          >
            <TerminalGroupPane
              tab={tab}
              group={group}
              config={config}
              isFocused={activeGroupId === group.id}
              canSplit={canSplit && i === groups.length - 1}
              canClose={groups.length > 1}
              showSplitZone={isDraggingTerminal && groups.length === 1}
              onDragStartAny={() => setIsDraggingTerminal(true)}
              onDragEndAny={() => setIsDraggingTerminal(false)}
            />
          </div>
        </Fragment>
      ))}
    </div>
  )
}
