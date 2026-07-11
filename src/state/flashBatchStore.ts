import { create } from 'zustand'
import { flashEsp32, onFlashDone, onFlashProgress, type FlashSegmentReq } from '../api/flash'
import i18n from '../i18n'
import { useToastStore } from './toastStore'

// Batch flash reuses the exact same `flash_esp32` Tauri command as the
// single-device flow (see flashStore.ts) — it spawns a plain OS thread per
// call with no global lock, so N ports can flash concurrently for free.
// The only thing batch mode adds is calling it once per selected port and
// keeping N progress states straight, which it does by using each port's
// name as that call's session `id` (flashStore's single-device flow uses a
// fixed 'flash-session' id instead, so the two can never collide).
export type BatchDeviceStatus = 'idle' | 'flashing' | 'done' | 'error'

export interface BatchDevice {
  portName: string
  status: BatchDeviceStatus
  progressCurrent: number
  progressTotal: number
  message: string
}

interface FlashBatchState {
  devices: BatchDevice[]
  eventsWired: boolean
  /** "Auto-flash on plug" — when on, a newly plugged device that looks like
   * an ESP32 (see esp32VidPid.ts) gets the current baud/segments flashed to
   * it immediately, no per-device confirmation. Off by default; the toggle
   * itself is the safety gate for unattended/production flashing. */
  autoFlashArmed: boolean

  wireEventsOnce: () => void
  setSelectedPorts: (portNames: string[]) => void
  setAutoFlashArmed: (armed: boolean) => void
  flashAll: (baudRate: number, segments: FlashSegmentReq[]) => void
  /** Flashes a single newly-plugged port, adding it to the device list if
   * not already tracked. Skips ports already mid-flash so the hotplug
   * listener firing more than once for the same physical plug can't
   * double-start a flash. */
  autoFlashDevice: (portName: string, baudRate: number, segments: FlashSegmentReq[]) => void
}

export const useFlashBatchStore = create<FlashBatchState>((set, get) => ({
  devices: [],
  eventsWired: false,
  autoFlashArmed: false,

  wireEventsOnce: () => {
    if (get().eventsWired) return
    set({ eventsWired: true })

    void onFlashProgress((event) => {
      set((state) => ({
        devices: state.devices.map((d) => {
          if (d.portName !== event.id) return d
          if (event.phase === 'writing') {
            return {
              ...d,
              progressCurrent: event.current ?? 0,
              progressTotal: event.total ?? 0,
            }
          }
          if (event.phase === 'verifying') return { ...d, message: 'Verifying…' }
          return d
        }),
      }))
    })

    void onFlashDone((event) => {
      set((state) => ({
        devices: state.devices.map((d) =>
          d.portName === event.id
            ? { ...d, status: event.success ? 'done' : 'error', message: event.message }
            : d,
        ),
      }))
      const addToast = useToastStore.getState().addToast
      if (event.success) {
        addToast('success', i18n.t('toast.batchFlashDone', { port: event.id }))
      } else {
        addToast(
          'error',
          i18n.t('toast.batchFlashError', { port: event.id, message: event.message }),
        )
      }
    })
  },

  // Ticking one port checkbox shouldn't wipe another's finished status —
  // keep the existing entry (including a prior run's done/error) for any
  // port that's already tracked, and only default fresh ones to idle.
  setSelectedPorts: (portNames) =>
    set((state) => ({
      devices: portNames.map(
        (portName) =>
          state.devices.find((d) => d.portName === portName) ?? {
            portName,
            status: 'idle',
            progressCurrent: 0,
            progressTotal: 0,
            message: '',
          },
      ),
    })),

  setAutoFlashArmed: (armed) => set({ autoFlashArmed: armed }),

  autoFlashDevice: (portName, baudRate, segments) => {
    const existing = get().devices.find((d) => d.portName === portName)
    if (existing?.status === 'flashing') return
    set((state) => ({
      devices: [
        ...state.devices.filter((d) => d.portName !== portName),
        { portName, status: 'flashing', progressCurrent: 0, progressTotal: 0, message: '' },
      ],
    }))
    void flashEsp32(portName, portName, baudRate, segments).catch((err) => {
      set((state) => ({
        devices: state.devices.map((d) =>
          d.portName === portName ? { ...d, status: 'error', message: String(err) } : d,
        ),
      }))
    })
  },

  flashAll: (baudRate, segments) => {
    const { devices } = get()
    set({
      devices: devices.map((d) => ({
        ...d,
        status: 'flashing',
        progressCurrent: 0,
        progressTotal: 0,
        message: '',
      })),
    })
    for (const device of devices) {
      // flash_esp32 reports failure via the flash://done event (success:
      // false), never by rejecting the invoke() promise -- this catch is
      // just a defensive backstop for an IPC-level failure, not the normal
      // error path.
      void flashEsp32(device.portName, device.portName, baudRate, segments).catch((err) => {
        set((state) => ({
          devices: state.devices.map((d) =>
            d.portName === device.portName ? { ...d, status: 'error', message: String(err) } : d,
          ),
        }))
      })
    }
  },
}))
