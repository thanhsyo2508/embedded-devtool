import { create } from 'zustand'
import {
  ftpConnect,
  ftpCwd,
  ftpDelete,
  ftpDisconnect,
  ftpDownload,
  ftpList,
  ftpMkdir,
  ftpPwd,
  ftpRename,
  ftpRmdir,
  ftpServerIsRunning,
  ftpServerStart,
  ftpServerStop,
  ftpUpload,
  onFtpTransferDone,
  type FtpEntry,
} from '../api/ftp'
import i18n from '../i18n'
import { useToastStore } from './toastStore'

// Single FTP client session and single FTP server instance for now, same
// "one at a time" v1 scope as OTA — the id just needs to be stable so
// transfer-done events can be told apart from anything else.
const SESSION_ID = 'ftp-client-session'

interface FtpState {
  // Client connection form + session
  host: string
  port: number
  username: string
  password: string
  connected: boolean
  connecting: boolean
  connectError: string | null
  currentPath: string
  entries: FtpEntry[]
  listing: boolean
  transferBusy: boolean
  eventsWired: boolean

  // Server
  serverRootDir: string
  serverPort: number
  serverUsername: string
  serverPassword: string
  serverRunning: boolean
  serverBusy: boolean
  serverError: string | null

  wireEventsOnce: () => void
  setHost: (v: string) => void
  setPort: (v: number) => void
  setUsername: (v: string) => void
  setPassword: (v: string) => void
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  refresh: () => Promise<void>
  openDir: (name: string) => Promise<void>
  goUp: () => Promise<void>
  goToPath: (path: string) => Promise<void>
  mkdir: (name: string) => Promise<void>
  deleteEntry: (entry: FtpEntry) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
  download: (entry: FtpEntry, localPath: string) => Promise<void>
  upload: (localPath: string, fileName: string) => Promise<void>

  loadServerStatus: () => Promise<void>
  setServerRootDir: (v: string) => void
  setServerPort: (v: number) => void
  setServerUsername: (v: string) => void
  setServerPassword: (v: string) => void
  startServer: () => Promise<void>
  stopServer: () => Promise<void>
}

function joinPath(base: string, name: string): string {
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`
}

export const useFtpStore = create<FtpState>((set, get) => ({
  host: '',
  port: 21,
  username: 'anonymous',
  password: '',
  connected: false,
  connecting: false,
  connectError: null,
  currentPath: '/',
  entries: [],
  listing: false,
  transferBusy: false,
  eventsWired: false,

  serverRootDir: '',
  serverPort: 2121,
  serverUsername: '',
  serverPassword: '',
  serverRunning: false,
  serverBusy: false,
  serverError: null,

  wireEventsOnce: () => {
    if (get().eventsWired) return
    set({ eventsWired: true })

    void onFtpTransferDone((event) => {
      if (event.id !== SESSION_ID) return
      set({ transferBusy: false })
      const addToast = useToastStore.getState().addToast
      if (event.success) {
        addToast('success', event.message)
        void get().refresh()
      } else {
        addToast('error', i18n.t('toast.ftpTransferError', { message: event.message }))
      }
    })
  },

  setHost: (host) => set({ host }),
  setPort: (port) => set({ port }),
  setUsername: (username) => set({ username }),
  setPassword: (password) => set({ password }),

  connect: async () => {
    const { host, port, username, password } = get()
    if (!host) return
    set({ connecting: true, connectError: null })
    try {
      await ftpConnect(SESSION_ID, host, port, username, password)
      const currentPath = await ftpPwd(SESSION_ID)
      set({ connected: true, connecting: false, currentPath })
      await get().refresh()
    } catch (err) {
      set({ connecting: false, connectError: String(err) })
    }
  },

  disconnect: async () => {
    await ftpDisconnect(SESSION_ID).catch(() => {})
    set({ connected: false, entries: [], currentPath: '/' })
  },

  refresh: async () => {
    set({ listing: true })
    try {
      const entries = await ftpList(SESSION_ID, '')
      set({ entries, listing: false })
    } catch (err) {
      set({ listing: false, connectError: String(err) })
    }
  },

  openDir: async (name) => {
    try {
      await ftpCwd(SESSION_ID, name)
      const currentPath = await ftpPwd(SESSION_ID)
      set({ currentPath })
      await get().refresh()
    } catch (err) {
      set({ connectError: String(err) })
    }
  },

  goUp: async () => {
    await get().openDir('..')
  },

  goToPath: async (path) => {
    try {
      await ftpCwd(SESSION_ID, path)
      const currentPath = await ftpPwd(SESSION_ID)
      set({ currentPath })
      await get().refresh()
    } catch (err) {
      set({ connectError: String(err) })
    }
  },

  mkdir: async (name) => {
    try {
      await ftpMkdir(SESSION_ID, name)
      await get().refresh()
    } catch (err) {
      set({ connectError: String(err) })
    }
  },

  deleteEntry: async (entry) => {
    try {
      if (entry.isDir) await ftpRmdir(SESSION_ID, entry.name)
      else await ftpDelete(SESSION_ID, entry.name)
      await get().refresh()
    } catch (err) {
      set({ connectError: String(err) })
    }
  },

  rename: async (from, to) => {
    try {
      await ftpRename(SESSION_ID, from, to)
      await get().refresh()
    } catch (err) {
      set({ connectError: String(err) })
    }
  },

  download: async (entry, localPath) => {
    set({ transferBusy: true })
    try {
      await ftpDownload(SESSION_ID, entry.name, localPath)
    } catch (err) {
      set({ transferBusy: false, connectError: String(err) })
    }
  },

  upload: async (localPath, fileName) => {
    set({ transferBusy: true })
    try {
      await ftpUpload(SESSION_ID, localPath, joinPath(get().currentPath, fileName))
    } catch (err) {
      set({ transferBusy: false, connectError: String(err) })
    }
  },

  loadServerStatus: async () => {
    const serverRunning = await ftpServerIsRunning().catch(() => false)
    set({ serverRunning })
  },

  setServerRootDir: (serverRootDir) => set({ serverRootDir }),
  setServerPort: (serverPort) => set({ serverPort }),
  setServerUsername: (serverUsername) => set({ serverUsername }),
  setServerPassword: (serverPassword) => set({ serverPassword }),

  startServer: async () => {
    const { serverRootDir, serverPort, serverUsername, serverPassword } = get()
    if (!serverRootDir) return
    set({ serverBusy: true, serverError: null })
    try {
      await ftpServerStart(
        serverRootDir,
        serverPort,
        serverUsername || undefined,
        serverUsername ? serverPassword : undefined,
      )
      set({ serverRunning: true, serverBusy: false })
    } catch (err) {
      set({ serverBusy: false, serverError: String(err) })
    }
  },

  stopServer: async () => {
    set({ serverBusy: true })
    await ftpServerStop().catch(() => {})
    set({ serverRunning: false, serverBusy: false })
  },
}))
