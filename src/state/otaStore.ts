import { create } from 'zustand'
import { onOtaDone, onOtaProgress, otaFlashEsp32 } from '../api/flash'
import i18n from '../i18n'
import { useToastStore } from './toastStore'

// Single OTA session for now, mirroring flashStore's single-device serial
// flow — the id just needs to be stable so progress/done events can be
// told apart from a future second session.
const SESSION_ID = 'ota-session'

interface OtaState {
  host: string
  port: number
  password: string
  firmwarePath: string
  busy: boolean
  phase: string
  progressCurrent: number
  progressTotal: number
  log: string[]
  eventsWired: boolean

  wireEventsOnce: () => void
  setHost: (v: string) => void
  setPort: (v: number) => void
  setPassword: (v: string) => void
  setFirmwarePath: (v: string) => void
  flash: () => Promise<void>
}

function appendLog(state: OtaState, line: string): Pick<OtaState, 'log'> {
  return { log: [...state.log, line].slice(-200) }
}

const PHASE_LABELS: Record<string, string> = {
  inviting: 'Inviting device…',
  authenticating: 'Authenticating…',
  waitingForDevice: 'Waiting for device to connect back…',
}

export const useOtaStore = create<OtaState>((set, get) => ({
  host: '',
  port: 3232,
  password: '',
  firmwarePath: '',
  busy: false,
  phase: '',
  progressCurrent: 0,
  progressTotal: 0,
  log: [],
  eventsWired: false,

  wireEventsOnce: () => {
    if (get().eventsWired) return
    set({ eventsWired: true })

    void onOtaProgress((event) => {
      if (event.id !== SESSION_ID) return
      set((state) => {
        if (event.phase === 'writing') {
          return {
            phase: event.phase,
            progressCurrent: event.current ?? 0,
            progressTotal: event.total ?? 0,
          }
        }
        const label = PHASE_LABELS[event.phase] ?? event.phase
        return { phase: event.phase, ...appendLog(state, label) }
      })
    })

    void onOtaDone((event) => {
      if (event.id !== SESSION_ID) return
      set((state) => ({
        busy: false,
        ...appendLog(state, event.success ? `✓ ${event.message}` : `✗ ${event.message}`),
      }))
      const addToast = useToastStore.getState().addToast
      if (event.success) {
        addToast('success', i18n.t('toast.otaDone'))
      } else {
        addToast('error', i18n.t('toast.otaError', { message: event.message }))
      }
    })
  },

  setHost: (host) => set({ host }),
  setPort: (port) => set({ port }),
  setPassword: (password) => set({ password }),
  setFirmwarePath: (firmwarePath) => set({ firmwarePath }),

  flash: async () => {
    const { host, port, password, firmwarePath } = get()
    if (!host || !firmwarePath) return
    set((state) => ({
      busy: true,
      progressCurrent: 0,
      progressTotal: 0,
      ...appendLog(state, `Connecting to ${host}:${port}…`),
    }))
    try {
      await otaFlashEsp32(SESSION_ID, host, port, password, firmwarePath)
    } catch (err) {
      set((state) => ({ busy: false, ...appendLog(state, `✗ ${String(err)}`) }))
    }
  },
}))
