import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type FlashTarget = 'esp32' | 'stm32' | 'ota' | 'debug' | 'stats'
export type FlashMode = 'single' | 'batch' | 'provision' | 'security'

interface FlashPanelUiState {
  target: FlashTarget
  mode: FlashMode
  setTarget: (target: FlashTarget) => void
  setMode: (mode: FlashMode) => void
}

/** Remembers which top-level target (ESP32/STM32/OTA/Debug/Stats) and which
 * ESP32 mode (Single/Batch/Provision/Security) was showing in the Flash
 * panel -- the panel unmounts entirely on close (see App.tsx's
 * `{showFlash && <FlashPanel .../>}`), so plain component state reset back
 * to the ESP32/Single defaults every time it was reopened mid-session,
 * e.g. after flashing STM32, checking the log elsewhere, then reopening. */
export const useFlashPanelStore = create<FlashPanelUiState>()(
  persist(
    (set) => ({
      target: 'esp32',
      mode: 'single',
      setTarget: (target) => set({ target }),
      setMode: (mode) => set({ mode }),
    }),
    { name: 'edt-flash-panel-ui' },
  ),
)
