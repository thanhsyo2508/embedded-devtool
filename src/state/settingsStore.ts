import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Encoding = 'utf-8' | 'ascii'
export type NewlineMode = 'crlf' | 'cr' | 'lf'
export type FontSize = 'small' | 'medium' | 'large'
export type Theme = 'system' | 'dark' | 'light'

export const FONT_SIZE_PX: Record<FontSize, string> = {
  small: '11px',
  medium: '12px',
  large: '14px',
}

export const MAX_LINES_OPTIONS = [1_000, 10_000, 50_000, 100_000, 500_000] as const
export const PLOT_MAX_POINTS_OPTIONS = [5_000, 10_000, 50_000, 100_000, 500_000] as const

interface SettingsState {
  encoding: Encoding
  maxLinesPerTab: number
  /** Points kept per channel before the plotter drops the oldest — same
   * sliding-window trim as maxLinesPerTab, just for the chart buffer
   * instead of the monitor's line buffer. */
  plotMaxPoints: number
  newline: NewlineMode
  fontSize: FontSize
  theme: Theme
  keepAwake: boolean
  setEncoding: (v: Encoding) => void
  setMaxLinesPerTab: (v: number) => void
  setPlotMaxPoints: (v: number) => void
  setNewline: (v: NewlineMode) => void
  setFontSize: (v: FontSize) => void
  setTheme: (v: Theme) => void
  setKeepAwake: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      encoding: 'utf-8',
      maxLinesPerTab: 50_000,
      plotMaxPoints: 50_000,
      newline: 'lf',
      fontSize: 'medium',
      theme: 'system',
      keepAwake: false,
      setEncoding: (encoding) => set({ encoding }),
      setMaxLinesPerTab: (maxLinesPerTab) => set({ maxLinesPerTab }),
      setPlotMaxPoints: (plotMaxPoints) => set({ plotMaxPoints }),
      setNewline: (newline) => set({ newline }),
      setFontSize: (fontSize) => set({ fontSize }),
      setTheme: (theme) => set({ theme }),
      setKeepAwake: (keepAwake) => set({ keepAwake }),
    }),
    { name: 'edt-settings' },
  ),
)
