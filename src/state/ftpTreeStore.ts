import { create } from 'zustand'
import {
  ftpConnect,
  ftpDelete,
  ftpDownload,
  ftpList,
  ftpMkdir,
  ftpReadFile,
  ftpRename,
  ftpRmdir,
  ftpUpload,
  ftpWriteFile,
  onFtpTransferDone,
  onFtpTransferProgress,
  type FtpEntry,
} from '../api/ftp'
import i18n from '../i18n'
import { useToastStore } from './toastStore'

// Mirrors sftpStore.ts's tree+editor-groups shape, adapted for the FTP
// client instead of SSH's SFTP subsystem — see that file for the fuller
// rationale behind each piece (per-tab session keying, editor groups,
// binary/large-file guards, ...). FTP has no key-based auth, so its
// connection config is just host/port/username/password.
export interface FtpConnectionConfig {
  host: string
  port: number
  username: string
  password: string
}

interface FtpTreeNodeState {
  entries: FtpEntry[] | null
  loading: boolean
  error: string | null
}

export interface OpenFtpFile {
  path: string
  name: string
  content: string
  originalContent: string
  loading: boolean
  saving: boolean
  error: string | null
  isBinary: boolean
}

export interface FtpEditorGroup {
  id: string
  filePaths: string[]
  activeFilePath: string | null
}

export interface FtpTransferProgress {
  operation: 'upload' | 'download'
  transferred: number
  total: number
}

interface FtpTabSession {
  connected: boolean
  connecting: boolean
  connectError: string | null
  /** Stashed on a successful connect so `reconnect` can redial without the
   * caller having to supply host/port/username/password again. */
  config: FtpConnectionConfig | null
  sidebarVisible: boolean
  nodes: Record<string, FtpTreeNodeState>
  expanded: Set<string>
  openFiles: OpenFtpFile[]
  groups: FtpEditorGroup[]
  activeGroupId: string
  transferProgress: FtpTransferProgress | null
}

const ROOT_PATH = ''
const INITIAL_GROUP_ID = 'group-1'

function emptySession(): FtpTabSession {
  return {
    connected: false,
    connecting: false,
    connectError: null,
    config: null,
    // Unlike the SSH+SFTP workspace (sidebar is opt-in, the terminal is the
    // useful default view), an FTP tab has no other content — starting
    // collapsed would just show a blank pane until the user finds the
    // toggle button.
    sidebarVisible: true,
    nodes: {},
    expanded: new Set(),
    openFiles: [],
    groups: [{ id: INITIAL_GROUP_ID, filePaths: [], activeFilePath: null }],
    activeGroupId: INITIAL_GROUP_ID,
    transferProgress: null,
  }
}

/** Stable fallback for `sessions[tabId]` before `ensureSession`/
 * `toggleSidebar` has ever run for that tab — a single module-level
 * instance so it's referentially stable across renders. */
export const DEFAULT_FTP_SESSION: FtpTabSession = emptySession()

function bytesToText(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes))
}

const BINARY_SNIFF_LENGTH = 8000
function isBinaryContent(bytes: number[]): boolean {
  const end = Math.min(bytes.length, BINARY_SNIFF_LENGTH)
  for (let i = 0; i < end; i++) {
    if (bytes[i] === 0) return true
  }
  return false
}

const LARGE_FILE_WARN_BYTES = 2 * 1024 * 1024
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

function textToBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

function joinPath(base: string, name: string): string {
  if (!base) return name
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`
}

interface FtpTreeState {
  sessions: Record<string, FtpTabSession>
  eventsWired: boolean

  wireEventsOnce: () => void
  ensureSession: (tabId: string) => FtpTabSession

  /** Marks this tab's FTP session live and lists the root — a no-op past
   * the first call. Unlike SFTP-over-SSH (a genuinely separate connection
   * from the SSH tab's own), an FTP tab has exactly one control connection
   * total, already dialed by `tabsStore.openTab` before this tab ever
   * existed — dialing a second one here would waste a handshake and, worse,
   * would break the many minimal embedded FTP servers that only accept one
   * client at a time. `config` is stashed only so a later manual
   * `reconnect` can redial without re-prompting for credentials. */
  ensureConnected: (tabId: string, config: FtpConnectionConfig) => void
  toggleSidebar: (tabId: string) => void
  reconnect: (tabId: string) => Promise<void>
  toggleNode: (tabId: string, path: string) => Promise<void>
  refreshNode: (tabId: string, path: string) => Promise<void>

  openFile: (tabId: string, entry: FtpEntry, groupId?: string) => Promise<void>
  closeFile: (tabId: string, groupId: string, path: string) => void
  closeFileEverywhere: (tabId: string, path: string) => void
  setActiveFile: (tabId: string, groupId: string, path: string) => void
  setActiveGroup: (tabId: string, groupId: string) => void
  splitGroupRight: (tabId: string, path: string) => void
  moveFileToGroup: (tabId: string, path: string, fromGroupId: string, toGroupId: string) => void
  closeGroup: (tabId: string, groupId: string) => void
  setFileContent: (tabId: string, path: string, content: string) => void
  saveFile: (tabId: string, path: string) => Promise<void>
  /** Saves every dirty, non-binary open file across both editor groups —
   * the "Save All" toolbar action. Runs concurrently (each write targets a
   * different remote path, so there's nothing to serialize for). */
  saveAllFiles: (tabId: string) => Promise<void>

  mkdir: (tabId: string, parentPath: string, name: string) => Promise<void>
  rmdir: (tabId: string, parentPath: string, entry: FtpEntry) => Promise<void>
  deleteEntry: (tabId: string, parentPath: string, entry: FtpEntry) => Promise<void>
  rename: (tabId: string, parentPath: string, from: string, to: string) => Promise<void>
  uploadBytes: (
    tabId: string,
    parentPath: string,
    fileName: string,
    bytes: number[],
  ) => Promise<void>
  uploadLocalFile: (tabId: string, parentPath: string, localPath: string) => Promise<void>
  downloadFile: (tabId: string, entry: FtpEntry, localPath: string) => Promise<void>

  disconnectSession: (tabId: string) => void
  disposeSession: (tabId: string) => void
}

function patchSession(
  set: (fn: (state: FtpTreeState) => Partial<FtpTreeState>) => void,
  tabId: string,
  patch: Partial<FtpTabSession> | ((session: FtpTabSession) => Partial<FtpTabSession>),
) {
  set((state) => {
    const current = state.sessions[tabId] ?? emptySession()
    const resolved = typeof patch === 'function' ? patch(current) : patch
    return { sessions: { ...state.sessions, [tabId]: { ...current, ...resolved } } }
  })
}

export const useFtpTreeStore = create<FtpTreeState>((set, get) => ({
  sessions: {},
  eventsWired: false,

  wireEventsOnce: () => {
    if (get().eventsWired) return
    set({ eventsWired: true })

    void onFtpTransferDone((event) => {
      const addToast = useToastStore.getState().addToast
      if (event.success) {
        addToast('success', event.message)
      } else {
        addToast('error', i18n.t('toast.ftpTransferError', { message: event.message }))
      }
      patchSession(set, event.id, { transferProgress: null })
    })

    void onFtpTransferProgress((event) => {
      patchSession(set, event.id, {
        transferProgress: {
          operation: event.operation,
          transferred: event.transferred,
          total: event.total,
        },
      })
    })
  },

  ensureSession: (tabId) => {
    const existing = get().sessions[tabId]
    if (existing) return existing
    const fresh = emptySession()
    set((state) => ({ sessions: { ...state.sessions, [tabId]: fresh } }))
    return fresh
  },

  ensureConnected: (tabId, config) => {
    get().wireEventsOnce()
    const session = get().ensureSession(tabId)
    if (session.connected || session.connecting) return
    patchSession(set, tabId, { connected: true, config })
    void get().toggleNode(tabId, ROOT_PATH)
  },

  toggleSidebar: (tabId) => {
    const session = get().ensureSession(tabId)
    patchSession(set, tabId, { sidebarVisible: !session.sidebarVisible })
  },

  /** Manual recovery for a session that's gone stale (e.g. the FTP control
   * connection silently dropped after a network blip) — `ftp_connect`
   * overwrites any existing session for this id server-side, so there's no
   * need to explicitly disconnect the dead one first. */
  reconnect: async (tabId) => {
    const session = get().ensureSession(tabId)
    if (!session.config || session.connecting) return
    const { config } = session
    patchSession(set, tabId, { connecting: true, connectError: null })
    try {
      await ftpConnect(tabId, config.host, config.port, config.username, config.password)
      patchSession(set, tabId, {
        connected: true,
        connecting: false,
        nodes: {},
        expanded: new Set(),
      })
      await get().toggleNode(tabId, ROOT_PATH)
    } catch (err) {
      patchSession(set, tabId, { connected: false, connecting: false, connectError: String(err) })
    }
  },

  toggleNode: async (tabId, path) => {
    const session = get().ensureSession(tabId)
    const expanded = new Set(session.expanded)
    if (expanded.has(path)) {
      expanded.delete(path)
      patchSession(set, tabId, { expanded })
      return
    }
    expanded.add(path)
    patchSession(set, tabId, { expanded })

    const node = session.nodes[path]
    if (node?.entries !== undefined && node?.entries !== null) return
    await get().refreshNode(tabId, path)
  },

  refreshNode: async (tabId, path) => {
    patchSession(set, tabId, (s) => ({
      nodes: {
        ...s.nodes,
        [path]: { entries: s.nodes[path]?.entries ?? null, loading: true, error: null },
      },
    }))
    try {
      const entries = await ftpList(tabId, path)
      patchSession(set, tabId, (s) => ({
        nodes: { ...s.nodes, [path]: { entries, loading: false, error: null } },
      }))
    } catch (err) {
      // A failure listing the *root* specifically (not some subfolder,
      // which could just be a permissions error) is the strongest signal
      // available that the whole FTP session died rather than one
      // operation — surface it as a disconnect so the sidebar shows a
      // Reconnect affordance instead of a dead, silently-stale tree. If
      // there's unsaved editor content sitting on top of that dead
      // connection, a toast is the only warning the user gets that a
      // Save right now won't actually persist anywhere.
      if (path === ROOT_PATH) {
        const hasUnsavedEdits = get().sessions[tabId]?.openFiles.some(
          (f) => f.content !== f.originalContent,
        )
        if (hasUnsavedEdits) {
          useToastStore.getState().addToast('error', i18n.t('ftp.tree.connectionLostWhileEditing'))
        }
      }
      patchSession(set, tabId, (s) => ({
        nodes: {
          ...s.nodes,
          [path]: { entries: s.nodes[path]?.entries ?? null, loading: false, error: String(err) },
        },
        ...(path === ROOT_PATH ? { connected: false, connectError: String(err) } : {}),
      }))
    }
  },

  openFile: async (tabId, entry, groupId) => {
    const session = get().ensureSession(tabId)
    const targetGroupId = groupId ?? session.activeGroupId
    const already = session.openFiles.find((f) => f.path === entry.path)
    if (already) {
      patchSession(set, tabId, (s) => ({
        groups: s.groups.map((g) =>
          g.id === targetGroupId
            ? {
                ...g,
                filePaths: g.filePaths.includes(entry.path)
                  ? g.filePaths
                  : [...g.filePaths, entry.path],
                activeFilePath: entry.path,
              }
            : g,
        ),
        activeGroupId: targetGroupId,
      }))
      return
    }
    if (
      entry.size > LARGE_FILE_WARN_BYTES &&
      !window.confirm(
        i18n.t('ftp.tree.largeFileConfirm', { size: formatBytes(entry.size), name: entry.name }),
      )
    ) {
      return
    }
    const placeholder: OpenFtpFile = {
      path: entry.path,
      name: entry.name,
      content: '',
      originalContent: '',
      loading: true,
      saving: false,
      error: null,
      isBinary: false,
    }
    patchSession(set, tabId, (s) => ({
      openFiles: [...s.openFiles, placeholder],
      groups: s.groups.map((g) =>
        g.id === targetGroupId
          ? { ...g, filePaths: [...g.filePaths, entry.path], activeFilePath: entry.path }
          : g,
      ),
      activeGroupId: targetGroupId,
    }))
    try {
      const bytes = await ftpReadFile(tabId, entry.path)
      if (isBinaryContent(bytes)) {
        patchSession(set, tabId, (s) => ({
          openFiles: s.openFiles.map((f) =>
            f.path === entry.path ? { ...f, loading: false, isBinary: true } : f,
          ),
        }))
        return
      }
      const text = bytesToText(bytes)
      patchSession(set, tabId, (s) => ({
        openFiles: s.openFiles.map((f) =>
          f.path === entry.path
            ? { ...f, content: text, originalContent: text, loading: false }
            : f,
        ),
      }))
    } catch (err) {
      patchSession(set, tabId, (s) => ({
        openFiles: s.openFiles.map((f) =>
          f.path === entry.path ? { ...f, loading: false, error: String(err) } : f,
        ),
      }))
    }
  },

  closeFile: (tabId, groupId, path) => {
    patchSession(set, tabId, (s) => {
      const groups = s.groups.map((g) => {
        if (g.id !== groupId) return g
        const filePaths = g.filePaths.filter((p) => p !== path)
        const activeFilePath =
          g.activeFilePath === path ? (filePaths[filePaths.length - 1] ?? null) : g.activeFilePath
        return { ...g, filePaths, activeFilePath }
      })
      const stillReferenced = new Set(groups.flatMap((g) => g.filePaths))
      const openFiles = s.openFiles.filter((f) => stillReferenced.has(f.path))
      return { groups, openFiles }
    })
  },

  closeFileEverywhere: (tabId, path) => {
    patchSession(set, tabId, (s) => {
      const groups = s.groups.map((g) => {
        if (!g.filePaths.includes(path)) return g
        const filePaths = g.filePaths.filter((p) => p !== path)
        const activeFilePath =
          g.activeFilePath === path ? (filePaths[filePaths.length - 1] ?? null) : g.activeFilePath
        return { ...g, filePaths, activeFilePath }
      })
      const openFiles = s.openFiles.filter((f) => f.path !== path)
      return { groups, openFiles }
    })
  },

  setActiveFile: (tabId, groupId, path) => {
    patchSession(set, tabId, (s) => ({
      groups: s.groups.map((g) => (g.id === groupId ? { ...g, activeFilePath: path } : g)),
      activeGroupId: groupId,
    }))
  },

  setActiveGroup: (tabId, groupId) => {
    patchSession(set, tabId, { activeGroupId: groupId })
  },

  splitGroupRight: (tabId, path) => {
    patchSession(set, tabId, (s) => {
      const [first, second] = s.groups
      const firstFilePaths = first.filePaths.filter((p) => p !== path)
      const firstActiveFilePath =
        first.activeFilePath === path
          ? (firstFilePaths[firstFilePaths.length - 1] ?? null)
          : first.activeFilePath
      const updatedFirst: FtpEditorGroup = {
        ...first,
        filePaths: firstFilePaths,
        activeFilePath: firstActiveFilePath,
      }
      if (second) {
        const groups = [
          updatedFirst,
          {
            ...second,
            filePaths: second.filePaths.includes(path)
              ? second.filePaths
              : [...second.filePaths, path],
            activeFilePath: path,
          },
        ]
        return { groups, activeGroupId: second.id }
      }
      const newGroup: FtpEditorGroup = {
        id: `group-${Date.now()}`,
        filePaths: [path],
        activeFilePath: path,
      }
      return { groups: [updatedFirst, newGroup], activeGroupId: newGroup.id }
    })
  },

  moveFileToGroup: (tabId, path, fromGroupId, toGroupId) => {
    if (fromGroupId === toGroupId) return
    patchSession(set, tabId, (s) => {
      const groups = s.groups.map((g) => {
        if (g.id === fromGroupId) {
          const filePaths = g.filePaths.filter((p) => p !== path)
          const activeFilePath =
            g.activeFilePath === path ? (filePaths[filePaths.length - 1] ?? null) : g.activeFilePath
          return { ...g, filePaths, activeFilePath }
        }
        if (g.id === toGroupId) {
          const filePaths = g.filePaths.includes(path) ? g.filePaths : [...g.filePaths, path]
          return { ...g, filePaths, activeFilePath: path }
        }
        return g
      })
      return { groups, activeGroupId: toGroupId }
    })
  },

  closeGroup: (tabId, groupId) => {
    patchSession(set, tabId, (s) => {
      if (s.groups.length <= 1) return {}
      const remaining = s.groups.filter((g) => g.id !== groupId)
      const stillReferenced = new Set(remaining.flatMap((g) => g.filePaths))
      const openFiles = s.openFiles.filter((f) => stillReferenced.has(f.path))
      const activeGroupId = s.activeGroupId === groupId ? remaining[0].id : s.activeGroupId
      return { groups: remaining, activeGroupId, openFiles }
    })
  },

  setFileContent: (tabId, path, content) => {
    patchSession(set, tabId, (s) => ({
      openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, content } : f)),
    }))
  },

  saveFile: async (tabId, path) => {
    const session = get().ensureSession(tabId)
    const file = session.openFiles.find((f) => f.path === path)
    if (!file || file.isBinary || file.content === file.originalContent) return
    patchSession(set, tabId, (s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, saving: true, error: null } : f,
      ),
    }))
    try {
      await ftpWriteFile(tabId, path, textToBytes(file.content))
      patchSession(set, tabId, (s) => ({
        openFiles: s.openFiles.map((f) =>
          f.path === path ? { ...f, saving: false, originalContent: f.content } : f,
        ),
      }))
    } catch (err) {
      patchSession(set, tabId, (s) => ({
        openFiles: s.openFiles.map((f) =>
          f.path === path ? { ...f, saving: false, error: String(err) } : f,
        ),
      }))
    }
  },

  saveAllFiles: async (tabId) => {
    const session = get().ensureSession(tabId)
    const dirty = session.openFiles.filter((f) => !f.isBinary && f.content !== f.originalContent)
    await Promise.all(dirty.map((f) => get().saveFile(tabId, f.path)))
  },

  mkdir: async (tabId, parentPath, name) => {
    await ftpMkdir(tabId, joinPath(parentPath, name)).catch((err) =>
      patchSession(set, tabId, { connectError: String(err) }),
    )
    await get().refreshNode(tabId, parentPath)
  },

  rmdir: async (tabId, parentPath, entry) => {
    await ftpRmdir(tabId, entry.path).catch((err) =>
      patchSession(set, tabId, { connectError: String(err) }),
    )
    await get().refreshNode(tabId, parentPath)
  },

  deleteEntry: async (tabId, parentPath, entry) => {
    const remove = entry.isDir ? ftpRmdir : ftpDelete
    await remove(tabId, entry.path).catch((err) =>
      patchSession(set, tabId, { connectError: String(err) }),
    )
    get().closeFileEverywhere(tabId, entry.path)
    await get().refreshNode(tabId, parentPath)
  },

  rename: async (tabId, parentPath, from, to) => {
    await ftpRename(tabId, from, to).catch((err) =>
      patchSession(set, tabId, { connectError: String(err) }),
    )
    await get().refreshNode(tabId, parentPath)
    // A plain same-folder rename has toParent === parentPath, so this is a
    // harmless repeat refresh there — but for a move (drag onto a
    // different folder), the destination's own listing needs refreshing
    // too, or the moved file won't show up in it until manually refreshed.
    const toName = to.split('/').pop() ?? to
    const toParent = to.slice(0, to.length - toName.length - 1)
    if (toParent !== parentPath) {
      await get().refreshNode(tabId, toParent)
    }
  },

  uploadBytes: async (tabId, parentPath, fileName, bytes) => {
    const remotePath = joinPath(parentPath, fileName)
    await ftpWriteFile(tabId, remotePath, bytes).catch((err) =>
      patchSession(set, tabId, { connectError: String(err) }),
    )
    await get().refreshNode(tabId, parentPath)
  },

  uploadLocalFile: async (tabId, parentPath, localPath) => {
    const fileName = localPath.split(/[\\/]/).pop() ?? localPath
    const remotePath = joinPath(parentPath, fileName)
    await ftpUpload(tabId, localPath, remotePath).catch((err) =>
      patchSession(set, tabId, { connectError: String(err) }),
    )
    await get().refreshNode(tabId, parentPath)
  },

  downloadFile: async (tabId, entry, localPath) => {
    await ftpDownload(tabId, entry.path, localPath).catch((err) =>
      patchSession(set, tabId, { connectError: String(err) }),
    )
  },

  // Unlike SFTP-over-SSH's `disconnectSession`, this doesn't call
  // `ftpDisconnect` itself — an FTP tab has exactly one connection, and
  // `tabsStore.disconnectTab` already closes it (the same way it closes a
  // serial/TCP/etc. tab's own stream). This only resets local tree/editor
  // state so the sidebar shows a Reconnect affordance instead of a
  // dead, silently-stale tree.
  disconnectSession: (tabId) => {
    patchSession(set, tabId, {
      connected: false,
      connecting: false,
      nodes: {},
      expanded: new Set(),
    })
  },

  disposeSession: (tabId) => {
    set((state) => {
      const sessions = { ...state.sessions }
      delete sessions[tabId]
      return { sessions }
    })
  },
}))
