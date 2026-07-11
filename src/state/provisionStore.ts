import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { closeSerialPort, onSerialData, openSerialPort, writeSerialPort } from '../api/serial'
import { LINE_ENDING_BYTES, type LineEnding } from './tabsStore'
import i18n from '../i18n'
import { useToastStore } from './toastStore'

// Serial-command provisioning: a short scripted sequence of writes (and
// optional wait-for-response gates) run automatically the moment a newly
// plugged device is detected — e.g. "send AT+SETID=..., wait for OK, send
// AT+SAVE". Deliberately separate from ESP32 flashing (flashStore/
// flashBatchStore): this operates on an already-flashed device's serial
// port with plain reads/writes, not espflash, so it works for any firmware
// that speaks a text command protocol, not just ESP32.
export interface ProvisionStep {
  id: string
  payload: string
  lineEnding: LineEnding
  waitForResponse: boolean
  /** Substring to look for in the accumulated response; empty means "any
   * bytes at all" satisfy the wait. */
  responseMatch: string
  timeoutMs: number
  /** Fixed pause after this step when not waiting for a response — some
   * devices need a settle gap even for fire-and-forget commands. */
  delayMs: number
}

export type ProvisionDeviceStatus = 'idle' | 'running' | 'done' | 'error'

export interface ProvisionDevice {
  portName: string
  status: ProvisionDeviceStatus
  stepIndex: number
  log: string[]
}

function newStep(): ProvisionStep {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    payload: '',
    lineEnding: 'crlf',
    waitForResponse: false,
    responseMatch: '',
    timeoutMs: 2000,
    delayMs: 100,
  }
}

// Keyed by each run's throwaway session id — holds the accumulated response
// text for whichever step is currently wait-for-response'ing. Lives outside
// Zustand state since promise resolvers aren't serializable and don't need
// to trigger re-renders themselves.
const pendingWaits = new Map<
  string,
  { buffer: string; matchStr: string; resolve: (matched: boolean) => void }
>()

function waitForResponse(sessionId: string, matchStr: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingWaits.delete(sessionId)
      resolve(false)
    }, timeoutMs)
    pendingWaits.set(sessionId, {
      buffer: '',
      matchStr,
      resolve: (matched) => {
        clearTimeout(timer)
        resolve(matched)
      },
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface ProvisionState {
  steps: ProvisionStep[]
  baudRate: number
  /** "Auto-run on plug" — off by default and never persisted armed, same
   * safety posture as flashBatchStore's autoFlashArmed: a workflow that
   * writes to a device unattended needs an explicit per-session opt-in. */
  armed: boolean
  devices: ProvisionDevice[]
  eventsWired: boolean

  wireEventsOnce: () => void
  addStep: () => void
  removeStep: (id: string) => void
  updateStep: (id: string, patch: Partial<ProvisionStep>) => void
  setBaudRate: (baudRate: number) => void
  setArmed: (armed: boolean) => void
  /** Runs the current step list against `portName`, opening and closing its
   * own throwaway serial session — skips if already running on that port,
   * so the hotplug listener firing more than once for one physical plug
   * can't start two overlapping runs. */
  runOnDevice: (portName: string) => void
}

export const useProvisionStore = create<ProvisionState>()(
  persist(
    (set, get) => {
      const updateDevice = (portName: string, patch: Partial<ProvisionDevice>) =>
        set((state) => ({
          devices: state.devices.some((d) => d.portName === portName)
            ? state.devices.map((d) => (d.portName === portName ? { ...d, ...patch } : d))
            : [
                ...state.devices,
                { portName, status: 'idle', stepIndex: 0, log: [], ...patch } as ProvisionDevice,
              ],
        }))

      const appendDeviceLog = (portName: string, line: string) =>
        set((state) => ({
          devices: state.devices.map((d) =>
            d.portName === portName ? { ...d, log: [...d.log, line].slice(-50) } : d,
          ),
        }))

      return {
        steps: [],
        baudRate: 115_200,
        armed: false,
        devices: [],
        eventsWired: false,

        wireEventsOnce: () => {
          if (get().eventsWired) return
          set({ eventsWired: true })
          void onSerialData((batch) => {
            const wait = pendingWaits.get(batch.id)
            if (!wait) return
            wait.buffer += new TextDecoder().decode(new Uint8Array(batch.data))
            if (wait.matchStr === '' || wait.buffer.includes(wait.matchStr)) {
              pendingWaits.delete(batch.id)
              wait.resolve(true)
            }
          })
        },

        addStep: () => set((state) => ({ steps: [...state.steps, newStep()] })),
        removeStep: (id) => set((state) => ({ steps: state.steps.filter((s) => s.id !== id) })),
        updateStep: (id, patch) =>
          set((state) => ({
            steps: state.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
          })),
        setBaudRate: (baudRate) => set({ baudRate }),
        setArmed: (armed) => set({ armed }),

        runOnDevice: (portName) => {
          const { steps, baudRate, devices } = get()
          if (steps.length === 0) return
          if (devices.find((d) => d.portName === portName)?.status === 'running') return

          const sessionId = `provision-${portName}-${Date.now()}`
          updateDevice(portName, { status: 'running', stepIndex: 0, log: [] })
          appendDeviceLog(portName, `Connecting to ${portName} @ ${baudRate}…`)

          void (async () => {
            try {
              await openSerialPort({ id: sessionId, portName, baudRate, autoReconnect: false })
              for (let i = 0; i < steps.length; i++) {
                const step = steps[i]
                updateDevice(portName, { stepIndex: i })
                const bytes = [
                  ...Array.from(new TextEncoder().encode(step.payload)),
                  ...LINE_ENDING_BYTES[step.lineEnding],
                ]
                await writeSerialPort(sessionId, bytes)
                appendDeviceLog(portName, `→ [${i + 1}/${steps.length}] ${step.payload}`)
                if (step.waitForResponse) {
                  const matched = await waitForResponse(
                    sessionId,
                    step.responseMatch,
                    step.timeoutMs,
                  )
                  if (!matched) {
                    throw new Error(`step ${i + 1} timed out waiting for response`)
                  }
                  appendDeviceLog(portName, `✓ [${i + 1}/${steps.length}] response matched`)
                } else if (step.delayMs > 0) {
                  await sleep(step.delayMs)
                }
              }
              updateDevice(portName, { status: 'done' })
              appendDeviceLog(portName, '✓ Workflow complete')
              useToastStore
                .getState()
                .addToast('success', i18n.t('toast.provisionDone', { port: portName }))
            } catch (err) {
              updateDevice(portName, { status: 'error' })
              appendDeviceLog(portName, `✗ ${String(err)}`)
              useToastStore
                .getState()
                .addToast(
                  'error',
                  i18n.t('toast.provisionError', { port: portName, message: String(err) }),
                )
            } finally {
              await closeSerialPort(sessionId).catch(() => {})
            }
          })()
        },
      }
    },
    {
      name: 'edt-provision-workflow',
      partialize: (state) => ({ steps: state.steps, baudRate: state.baudRate }),
    },
  ),
)
