import { create } from 'zustand'
import {
  detectStm32Mcu,
  findStm32Cli,
  flashStm32,
  massEraseStm32,
  onStm32Done,
  onStm32Output,
  parseStm32HexAddress,
  readStm32OptionBytes,
  writeStm32Memory,
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
  writeMemory: (address: string, data: number[]) => Promise<void>
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
  // A .hex file's own records carry an absolute address -- unlike a .bin
  // (a raw memory dump with no address information at all), so this is
  // the one format worth auto-filling the address field from instead of
  // making the user look it up and type it in.
  setFilePath: (filePath) => {
    set({ filePath })
    if (/\.hex$/i.test(filePath)) {
      parseStm32HexAddress(filePath)
        .then((address) => {
          if (address) set({ address })
        })
        .catch(() => {})
    }
  },
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

  // Pokes arbitrary bytes at `address`, independent of the main firmware
  // file/address fields above -- see stm32::write_memory's doc comment for
  // how this reuses the same flash mechanism via a small staged temp file.
  writeMemory: async (address, data) => {
    const { cliPath, verify, reset } = get()
    if (!cliPath) return
    set((state) => ({
      busy: true,
      ...appendLog(state, `Writing ${data.length} byte(s) at ${address}…`),
    }))
    try {
      await writeStm32Memory({
        id: SESSION_ID,
        cliPath,
        interface: get().currentInterface(),
        address,
        data,
        verify,
        reset,
      })
    } catch (err) {
      set((state) => ({ busy: false, ...appendLog(state, `✗ ${String(err)}`) }))
    }
  },
}))
