import { create } from 'zustand'
import { ftpServerIsRunning, ftpServerStart, ftpServerStop } from '../api/ftp'
import { localIpAddress } from '../api/network'

// Local FTP server config/control — see FtpPanel's module doc for why this
// store is server-only now (remote-file *browsing* moved to the tab-based
// FTP workspace, state/ftpTreeStore.ts). Single instance for now, same "one
// at a time" v1 scope as OTA.
//
// The server itself already binds 0.0.0.0 and replies to PASV with the
// connecting client's own address (libunftp's default `PassiveHost::
// FromConnection`), so it's reachable from the LAN with no extra backend
// config — the missing piece was purely discoverability: nothing told the
// user *which* address another device should type in. `serverAddress`
// closes that gap.
interface FtpState {
  serverRootDir: string
  serverPort: number
  serverUsername: string
  serverPassword: string
  serverRunning: boolean
  serverBusy: boolean
  serverError: string | null
  /** This machine's own LAN-facing IP, best-effort (see localIpAddress) —
   * null while unresolved (no network, or the lookup failed), in which case
   * the UI just doesn't show an address rather than a broken one. */
  serverAddress: string | null

  loadServerStatus: () => Promise<void>
  setServerRootDir: (v: string) => void
  setServerPort: (v: number) => void
  setServerUsername: (v: string) => void
  setServerPassword: (v: string) => void
  startServer: () => Promise<void>
  stopServer: () => Promise<void>
}

export const useFtpStore = create<FtpState>((set, get) => ({
  serverRootDir: '',
  serverPort: 2121,
  serverUsername: '',
  serverPassword: '',
  serverRunning: false,
  serverBusy: false,
  serverError: null,
  serverAddress: null,

  loadServerStatus: async () => {
    const serverRunning = await ftpServerIsRunning().catch(() => false)
    set({ serverRunning })
    const serverAddress = await localIpAddress().catch(() => null)
    set({ serverAddress })
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
