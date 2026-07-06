import { create } from 'zustand'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export type UpdateStatus =
  'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error'

interface UpdateState {
  status: UpdateStatus
  version: string | null
  body: string | null
  progress: number
  error: string | null
  // Not persisted in serializable state — the update handle itself is what
  // downloadAndInstall() runs against, so it has to stay in memory as-is.
  pending: Update | null

  checkForUpdate: () => Promise<void>
  installAndRelaunch: () => Promise<void>
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'idle',
  version: null,
  body: null,
  progress: 0,
  error: null,
  pending: null,

  checkForUpdate: async () => {
    set({ status: 'checking', error: null })
    try {
      const update = await check()
      if (update) {
        set({
          status: 'available',
          version: update.version,
          body: update.body ?? null,
          pending: update,
        })
      } else {
        set({ status: 'up-to-date', pending: null })
      }
    } catch (err) {
      set({ status: 'error', error: String(err) })
    }
  },

  installAndRelaunch: async () => {
    const update = get().pending
    if (!update) return
    set({ status: 'downloading', progress: 0, error: null })
    try {
      let downloaded = 0
      let total = 0
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          set({ progress: total > 0 ? Math.round((downloaded / total) * 100) : 0 })
        } else if (event.event === 'Finished') {
          set({ progress: 100 })
        }
      })
      set({ status: 'ready' })
      await relaunch()
    } catch (err) {
      set({ status: 'error', error: String(err) })
    }
  },
}))
