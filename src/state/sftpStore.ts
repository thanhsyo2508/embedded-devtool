import { create } from 'zustand'
import {
  onSftpTransferDone,
  sftpConnect,
  sftpDelete,
  sftpDisconnect,
  sftpList,
  sftpMkdir,
  sftpReadFile,
  sftpRename,
  sftpRmdir,
  sftpUpload,
  sftpWriteFile,
  type SftpEntry,
} from '../api/sftp'
import i18n from '../i18n'
import { useToastStore } from './toastStore'

export interface SftpConnectionConfig {
  host: string
  port: number
  username: string
  password: string
}

interface SftpTreeNodeState {
  entries: SftpEntry[] | null
  loading: boolean
  error: string | null
}

export interface OpenSftpFile {
  path: string
  name: string
  content: string
  originalContent: string
  loading: boolean
  saving: boolean
  error: string | null
}

/** One editor column (VSCode-style "editor group"). `filePaths` are
 * references into the session's shared `openFiles` — a file split into two
 * groups is the same underlying buffer in both, so editing it in either
 * group updates the other immediately (no separate copy to keep in sync). */
export interface SftpEditorGroup {
  id: string
  filePaths: string[]
  activeFilePath: string | null
}

interface SftpTabSession {
  connected: boolean
  connecting: boolean
  connectError: string | null
  sidebarVisible: boolean
  nodes: Record<string, SftpTreeNodeState>
  expanded: Set<string>
  openFiles: OpenSftpFile[]
  groups: SftpEditorGroup[]
  activeGroupId: string
}

const ROOT_PATH = ''
const INITIAL_GROUP_ID = 'group-1'

function emptySession(): SftpTabSession {
  return {
    connected: false,
    connecting: false,
    connectError: null,
    sidebarVisible: false,
    nodes: {},
    expanded: new Set(),
    openFiles: [],
    groups: [{ id: INITIAL_GROUP_ID, filePaths: [], activeFilePath: null }],
    activeGroupId: INITIAL_GROUP_ID,
  }
}

/** Stable fallback for `sessions[tabId]` before `ensureSession`/
 * `toggleSidebar` has ever run for that tab — a single module-level
 * instance so it's referentially stable across renders (not a new object
 * per selector call). */
export const DEFAULT_SFTP_SESSION: SftpTabSession = emptySession()

function bytesToText(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes))
}

function textToBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

function joinPath(base: string, name: string): string {
  if (!base) return name
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`
}

interface SftpState {
  sessions: Record<string, SftpTabSession>
  eventsWired: boolean

  wireEventsOnce: () => void
  ensureSession: (tabId: string) => SftpTabSession

  toggleSidebar: (tabId: string, config: SftpConnectionConfig) => Promise<void>
  toggleNode: (tabId: string, path: string) => Promise<void>
  refreshNode: (tabId: string, path: string) => Promise<void>

  openFile: (tabId: string, entry: SftpEntry, groupId?: string) => Promise<void>
  closeFile: (tabId: string, groupId: string, path: string) => void
  closeFileEverywhere: (tabId: string, path: string) => void
  setActiveFile: (tabId: string, groupId: string, path: string) => void
  setActiveGroup: (tabId: string, groupId: string) => void
  splitGroupRight: (tabId: string, path: string) => void
  moveFileToGroup: (tabId: string, path: string, fromGroupId: string, toGroupId: string) => void
  closeGroup: (tabId: string, groupId: string) => void
  setFileContent: (tabId: string, path: string, content: string) => void
  saveFile: (tabId: string, path: string) => Promise<void>

  mkdir: (tabId: string, parentPath: string, name: string) => Promise<void>
  rmdir: (tabId: string, parentPath: string, entry: SftpEntry) => Promise<void>
  deleteEntry: (tabId: string, parentPath: string, entry: SftpEntry) => Promise<void>
  rename: (tabId: string, parentPath: string, from: string, to: string) => Promise<void>
  uploadBytes: (
    tabId: string,
    parentPath: string,
    fileName: string,
    bytes: number[],
  ) => Promise<void>
  uploadLocalFile: (tabId: string, parentPath: string, localPath: string) => Promise<void>

  disconnectSession: (tabId: string) => Promise<void>
  disposeSession: (tabId: string) => void
}

function patchSession(
  set: (fn: (state: SftpState) => Partial<SftpState>) => void,
  tabId: string,
  patch: Partial<SftpTabSession> | ((session: SftpTabSession) => Partial<SftpTabSession>),
) {
  set((state) => {
    const current = state.sessions[tabId] ?? emptySession()
    const resolved = typeof patch === 'function' ? patch(current) : patch
    return { sessions: { ...state.sessions, [tabId]: { ...current, ...resolved } } }
  })
}

export const useSftpStore = create<SftpState>((set, get) => ({
  sessions: {},
  eventsWired: false,

  wireEventsOnce: () => {
    if (get().eventsWired) return
    set({ eventsWired: true })

    void onSftpTransferDone((event) => {
      const addToast = useToastStore.getState().addToast
      if (event.success) {
        addToast('success', event.message)
      } else {
        addToast('error', i18n.t('toast.sftpTransferError', { message: event.message }))
      }
    })
  },

  ensureSession: (tabId) => {
    const existing = get().sessions[tabId]
    if (existing) return existing
    const fresh = emptySession()
    set((state) => ({ sessions: { ...state.sessions, [tabId]: fresh } }))
    return fresh
  },

  toggleSidebar: async (tabId, config) => {
    get().wireEventsOnce()
    const session = get().ensureSession(tabId)
    const nextVisible = !session.sidebarVisible
    patchSession(set, tabId, { sidebarVisible: nextVisible })
    if (!nextVisible || session.connected || session.connecting) return

    patchSession(set, tabId, { connecting: true, connectError: null })
    try {
      await sftpConnect(tabId, config.host, config.port, config.username, config.password)
      patchSession(set, tabId, { connected: true, connecting: false })
      await get().toggleNode(tabId, ROOT_PATH)
    } catch (err) {
      patchSession(set, tabId, { connecting: false, connectError: String(err) })
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
      const entries = await sftpList(tabId, path)
      patchSession(set, tabId, (s) => ({
        nodes: { ...s.nodes, [path]: { entries, loading: false, error: null } },
      }))
    } catch (err) {
      patchSession(set, tabId, (s) => ({
        nodes: {
          ...s.nodes,
          [path]: { entries: s.nodes[path]?.entries ?? null, loading: false, error: String(err) },
        },
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
    const placeholder: OpenSftpFile = {
      path: entry.path,
      name: entry.name,
      content: '',
      originalContent: '',
      loading: true,
      saving: false,
      error: null,
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
      const bytes = await sftpReadFile(tabId, entry.path)
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

  /** VSCode-style "Split Right": opens `path` in a second editor group to
   * the right, capped at two groups for v1 (not arbitrary N-way nesting).
   * Both groups reference the same path, so they share the same buffer. */
  splitGroupRight: (tabId, path) => {
    patchSession(set, tabId, (s) => {
      const [first, second] = s.groups
      if (second) {
        const groups = [
          first,
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
      const newGroup: SftpEditorGroup = {
        id: `group-${Date.now()}`,
        filePaths: [path],
        activeFilePath: path,
      }
      return { groups: [first, newGroup], activeGroupId: newGroup.id }
    })
  },

  /** Drag-a-tab-onto-the-other-group move (VSCode-style) — distinct from
   * `splitGroupRight`, which creates the second group in the first place.
   * A no-op if the file is already in the target group or the two ids are
   * the same, so a drag that ends where it started doesn't touch state. */
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
    if (!file || file.content === file.originalContent) return
    patchSession(set, tabId, (s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, saving: true, error: null } : f,
      ),
    }))
    try {
      await sftpWriteFile(tabId, path, textToBytes(file.content))
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

  mkdir: async (tabId, parentPath, name) => {
    await sftpMkdir(tabId, joinPath(parentPath, name)).catch((err) =>
      patchSession(set, tabId, { connectError: String(err) }),
    )
    await get().refreshNode(tabId, parentPath)
  },

  rmdir: async (tabId, parentPath, entry) => {
    await sftpRmdir(tabId, entry.path).catch((err) =>
      patchSession(set, tabId, { connectError: String(err) }),
    )
    await get().refreshNode(tabId, parentPath)
  },

  deleteEntry: async (tabId, parentPath, entry) => {
    const remove = entry.isDir ? sftpRmdir : sftpDelete
    await remove(tabId, entry.path).catch((err) =>
      patchSession(set, tabId, { connectError: String(err) }),
    )
    get().closeFileEverywhere(tabId, entry.path)
    await get().refreshNode(tabId, parentPath)
  },

  rename: async (tabId, parentPath, from, to) => {
    await sftpRename(tabId, from, to).catch((err) =>
      patchSession(set, tabId, { connectError: String(err) }),
    )
    await get().refreshNode(tabId, parentPath)
  },

  uploadBytes: async (tabId, parentPath, fileName, bytes) => {
    const remotePath = joinPath(parentPath, fileName)
    await sftpWriteFile(tabId, remotePath, bytes).catch((err) =>
      patchSession(set, tabId, { connectError: String(err) }),
    )
    await get().refreshNode(tabId, parentPath)
  },

  uploadLocalFile: async (tabId, parentPath, localPath) => {
    const fileName = localPath.split(/[\\/]/).pop() ?? localPath
    const remotePath = joinPath(parentPath, fileName)
    await sftpUpload(tabId, localPath, remotePath).catch((err) =>
      patchSession(set, tabId, { connectError: String(err) }),
    )
    await get().refreshNode(tabId, parentPath)
  },

  disconnectSession: async (tabId) => {
    await sftpDisconnect(tabId).catch(() => {})
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
