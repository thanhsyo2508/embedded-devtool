import { create } from 'zustand'
import {
  detectStm32Mcu,
  findStm32Cli,
  flashStm32,
  massEraseStm32,
  onStm32Done,
  onStm32Output,
  readStm32OptionBytes,
  writeStm32OptionByte,
  type StmInterface,
  type StmMcuInfo,
} from '../api/stm32'

const SESSION_ID = 'stm32-session'

interface Stm32State {
  cliPath: string | null
  cliChecked: boolean
  interfaceKind: 'swLink' | 'uart'
  uartPort: string
  uartBaud: number
  mcuInfo: StmMcuInfo | null
  detecting: boolean
  filePath: string
  address: string
  verify: boolean
  reset: boolean
  busy: boolean
  optionBytesText: string | null
  log: string[]
  eventsWired: boolean

  wireEventsOnce: () => void
  checkCli: () => Promise<void>
  setInterfaceKind: (v: 'swLink' | 'uart') => void
  setUartPort: (v: string) => void
  setUartBaud: (v: number) => void
  setFilePath: (v: string) => void
  setAddress: (v: string) => void
  setVerify: (v: boolean) => void
  setReset: (v: boolean) => void
  detectMcu: () => Promise<void>
  flash: () => Promise<void>
  eraseFull: () => Promise<void>
  readOptionBytes: () => Promise<void>
  writeOptionByte: (name: string, value: string) => Promise<void>
  currentInterface: () => StmInterface
}

function appendLog(state: Stm32State, line: string): Pick<Stm32State, 'log'> {
  return { log: [...state.log, line].slice(-300) }
}

export const useStm32Store = create<Stm32State>((set, get) => ({
  cliPath: null,
  cliChecked: false,
  interfaceKind: 'swLink',
  uartPort: '',
  uartBaud: 115_200,
  mcuInfo: null,
  detecting: false,
  filePath: '',
  address: '0x08000000',
  verify: true,
  reset: true,
  busy: false,
  optionBytesText: null,
  log: [],
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
      set((state) => ({
        busy: false,
        ...appendLog(state, event.success ? `✓ ${event.message}` : `✗ ${event.message}`),
      }))
    })
  },

  checkCli: async () => {
    const cliPath = await findStm32Cli().catch(() => null)
    set({ cliPath, cliChecked: true })
  },

  setInterfaceKind: (interfaceKind) => set({ interfaceKind, mcuInfo: null }),
  setUartPort: (uartPort) => set({ uartPort }),
  setUartBaud: (uartBaud) => set({ uartBaud }),
  setFilePath: (filePath) => set({ filePath }),
  setAddress: (address) => set({ address }),
  setVerify: (verify) => set({ verify }),
  setReset: (reset) => set({ reset }),

  currentInterface: (): StmInterface => {
    const { interfaceKind, uartPort, uartBaud } = get()
    return interfaceKind === 'swLink'
      ? { kind: 'swLink' }
      : { kind: 'uart', port: uartPort, baud: uartBaud }
  },

  detectMcu: async () => {
    const { cliPath } = get()
    if (!cliPath) return
    set((state) => ({ detecting: true, ...appendLog(state, 'Connecting…') }))
    try {
      const mcuInfo = await detectStm32Mcu(cliPath, get().currentInterface())
      set((state) => ({
        mcuInfo,
        detecting: false,
        ...appendLog(state, `✓ ${mcuInfo.deviceName ?? 'connected'} (${mcuInfo.deviceId ?? '?'})`),
      }))
    } catch (err) {
      set((state) => ({ detecting: false, ...appendLog(state, `✗ ${String(err)}`) }))
    }
  },

  flash: async () => {
    const { cliPath, filePath, address, verify, reset } = get()
    if (!cliPath || !filePath) return
    set((state) => ({ busy: true, ...appendLog(state, `Flashing ${filePath} @ ${address}…`) }))
    try {
      await flashStm32({
        id: SESSION_ID,
        cliPath,
        interface: get().currentInterface(),
        filePath,
        address,
        verify,
        reset,
      })
    } catch (err) {
      set((state) => ({ busy: false, ...appendLog(state, `✗ ${String(err)}`) }))
    }
  },

  eraseFull: async () => {
    const { cliPath } = get()
    if (!cliPath) return
    set((state) => ({ busy: true, ...appendLog(state, 'Mass erase…') }))
    try {
      await massEraseStm32(SESSION_ID, cliPath, get().currentInterface())
    } catch (err) {
      set((state) => ({ busy: false, ...appendLog(state, `✗ ${String(err)}`) }))
    }
  },

  readOptionBytes: async () => {
    const { cliPath } = get()
    if (!cliPath) return
    set((state) => appendLog(state, 'Reading option bytes…'))
    try {
      const text = await readStm32OptionBytes(cliPath, get().currentInterface())
      set({ optionBytesText: text })
    } catch (err) {
      set((state) => appendLog(state, `✗ ${String(err)}`))
    }
  },

  writeOptionByte: async (name, value) => {
    const { cliPath } = get()
    if (!cliPath) return
    set((state) => ({ busy: true, ...appendLog(state, `Writing option byte ${name}=${value}…`) }))
    try {
      await writeStm32OptionByte(SESSION_ID, cliPath, get().currentInterface(), name, value)
    } catch (err) {
      set((state) => ({ busy: false, ...appendLog(state, `✗ ${String(err)}`) }))
    }
  },
}))
