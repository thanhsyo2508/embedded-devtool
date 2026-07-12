import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ToastKind = 'success' | 'error'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
  atMs: number
}

interface ToastState {
  toasts: Toast[]
  /** Every toast ever shown this session (and across restarts), newest
   * first, capped — unlike `toasts`, entries here survive the 6s
   * auto-dismiss so a background task's result isn't lost the moment you
   * look away. See NotificationBell. */
  history: Toast[]
  lastViewedAtMs: number
  addToast: (kind: ToastKind, message: string) => void
  removeToast: (id: string) => void
  clearHistory: () => void
  markViewed: () => void
}

// Long enough to read a full device/host name + message, short enough not
// to pile up during a batch run where several finish within seconds of
// each other.
const AUTO_DISMISS_MS = 6000
const MAX_HISTORY = 50

/** Background-task completion notifications — batch flash, auto-flash on
 * plug, provisioning, OTA, and FTP transfers all run independently of
 * whichever panel (if any) is open, so without this there's no way to
 * learn a task finished unless you're already looking at its specific
 * panel. */
export const useToastStore = create<ToastState>()(
  persist(
    (set, get) => ({
      toasts: [],
      history: [],
      lastViewedAtMs: 0,

      addToast: (kind, message) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const toast: Toast = { id, kind, message, atMs: Date.now() }
        set((state) => ({
          toasts: [...state.toasts, toast],
          history: [toast, ...state.history].slice(0, MAX_HISTORY),
        }))
        setTimeout(() => get().removeToast(id), AUTO_DISMISS_MS)
      },

      removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

      clearHistory: () => set({ history: [] }),

      markViewed: () => set({ lastViewedAtMs: Date.now() }),
    }),
    {
      name: 'edt-toast-history',
      // Only the history/lastViewedAtMs need to survive a restart — live
      // `toasts` are ephemeral and would otherwise reappear stale on relaunch.
      partialize: (state) => ({ history: state.history, lastViewedAtMs: state.lastViewedAtMs }),
    },
  ),
)
