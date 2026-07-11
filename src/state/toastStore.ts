import { create } from 'zustand'

export type ToastKind = 'success' | 'error'

export interface Toast {
  id: string
  kind: ToastKind
  message: string
}

interface ToastState {
  toasts: Toast[]
  addToast: (kind: ToastKind, message: string) => void
  removeToast: (id: string) => void
}

// Long enough to read a full device/host name + message, short enough not
// to pile up during a batch run where several finish within seconds of
// each other.
const AUTO_DISMISS_MS = 6000

/** Background-task completion notifications — batch flash, auto-flash on
 * plug, provisioning, and OTA all run independently of whichever panel
 * (if any) is open, so without this there's no way to learn a task
 * finished unless you're already looking at its specific panel. */
export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (kind, message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }))
    setTimeout(() => get().removeToast(id), AUTO_DISMISS_MS)
  },

  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))
