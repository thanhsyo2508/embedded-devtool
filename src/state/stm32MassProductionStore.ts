import { create } from 'zustand'
import { flashStm32, onStm32Done, onStm32Output } from '../api/stm32'
import { prepareProvisionedBinary, type ProvisionValueFormat } from '../api/flash'
import { useStm32Store } from './stm32Store'
import { useProductionHistoryStore } from './productionHistoryStore'
import { useToastStore } from './toastStore'
import i18n from '../i18n'

// Separate from stm32Store's fixed 'stm32-session' id so a mass-production
// run and an ad-hoc single flash (e.g. someone re-checking the CLI/MCU in
// the same session) can never collide on the same done-event stream.
const SESSION_ID = 'stm32-mass-production'

export interface MassProductionEntry {
  counter: number
  value: string
  success: boolean
  message: string
  atMs: number
}

interface Stm32MassProductionState {
  filePath: string
  address: string
  /** Hex string, e.g. "0x1000" — where in the binary to write the
   * per-device value. */
  patchOffset: string
  patchLength: number
  valueFormat: ProvisionValueFormat
  startCounter: number
  nextCounter: number
  /** The formatted value just written into the binary about to be
   * flashed — set right before flashing starts, read back by the done
   * handler to log the right value without re-deriving it from text. */
  pendingValueDisplay: string | null
  busy: boolean
  log: string[]
  entries: MassProductionEntry[]
  eventsWired: boolean

  wireEventsOnce: () => void
  setFilePath: (v: string) => void
  setAddress: (v: string) => void
  setPatchOffset: (v: string) => void
  setPatchLength: (v: number) => void
  setValueFormat: (v: ProvisionValueFormat) => void
  setStartCounter: (v: number) => void
  resetCounter: () => void
  flashNext: () => Promise<void>
}

function appendLog(
  state: Stm32MassProductionState,
  line: string,
): Pick<Stm32MassProductionState, 'log'> {
  return { log: [...state.log, line].slice(-300) }
}

export const useStm32MassProductionStore = create<Stm32MassProductionState>((set, get) => ({
  filePath: '',
  address: '0x08000000',
  patchOffset: '0x0',
  patchLength: 8,
  valueFormat: 'asciiDecimal',
  startCounter: 1,
  nextCounter: 1,
  pendingValueDisplay: null,
  busy: false,
  log: [],
  entries: [],
  eventsWired: false,

  wireEventsOnce: () => {
    if (get().eventsWired) return
    set({ eventsWired: true })

    void onStm32Output((event) => {
      if (event.id !== SESSION_ID) return
      set((state) => appendLog(state, event.line))
    })

    void onStm32Done((event) => {
      if (event.id !== SESSION_ID) return
      const counter = get().nextCounter
      const value = get().pendingValueDisplay ?? String(counter)
      set((state) => ({
        busy: false,
        nextCounter: event.success ? counter + 1 : counter,
        entries: [
          { counter, value, success: event.success, message: event.message, atMs: Date.now() },
          ...state.entries,
        ],
        ...appendLog(state, event.success ? `✓ ${event.message}` : `✗ ${event.message}`),
      }))

      const stm32 = useStm32Store.getState()
      useProductionHistoryStore.getState().addEntry({
        deviceType: 'stm32',
        port: stm32.interfaceKind === 'uart' ? stm32.uartPort : 'ST-Link',
        success: event.success,
        message: event.message,
        provisionedValue: value,
      })

      const addToast = useToastStore.getState().addToast
      if (event.success) {
        addToast('success', i18n.t('toast.massProductionDone', { counter, value }))
      } else {
        addToast('error', i18n.t('toast.massProductionError', { counter, message: event.message }))
      }
    })
  },

  setFilePath: (filePath) => set({ filePath }),
  setAddress: (address) => set({ address }),
  setPatchOffset: (patchOffset) => set({ patchOffset }),
  setPatchLength: (patchLength) => set({ patchLength }),
  setValueFormat: (valueFormat) => set({ valueFormat }),
  setStartCounter: (startCounter) => set({ startCounter, nextCounter: startCounter }),
  resetCounter: () => set((state) => ({ nextCounter: state.startCounter, entries: [] })),

  flashNext: async () => {
    const stm32 = useStm32Store.getState()
    const { cliPath } = stm32
    const { filePath, address, patchOffset, patchLength, valueFormat, nextCounter } = get()
    if (!cliPath || !filePath) return

    set((state) => ({
      busy: true,
      ...appendLog(state, `Provisioning device #${nextCounter}…`),
    }))
    try {
      const offset = parseInt(patchOffset, 16)
      if (Number.isNaN(offset)) throw new Error(`invalid patch offset "${patchOffset}"`)
      const provisioned = await prepareProvisionedBinary(
        filePath,
        offset,
        patchLength,
        valueFormat,
        nextCounter,
      )
      set((state) => ({
        pendingValueDisplay: provisioned.valueDisplay,
        ...appendLog(state, `Patched value ${provisioned.valueDisplay}, flashing…`),
      }))
      await flashStm32({
        id: SESSION_ID,
        cliPath,
        interface: stm32.currentInterface(),
        filePath: provisioned.path,
        address,
        verify: stm32.verify,
        reset: stm32.reset,
      })
    } catch (err) {
      set((state) => ({ busy: false, ...appendLog(state, `✗ ${String(err)}`) }))
    }
  },
}))
