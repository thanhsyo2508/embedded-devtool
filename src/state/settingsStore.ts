import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import i18n from '../i18n'

export type Encoding = 'utf-8' | 'ascii'
export type NewlineMode = 'crlf' | 'cr' | 'lf'
export type FontSize = 'small' | 'medium' | 'large'
export type Theme = 'system' | 'dark' | 'light'
export type Language = 'en' | 'vi'

export const FONT_SIZE_PX: Record<FontSize, string> = {
  small: '11px',
  medium: '12px',
  large: '14px',
}

export const MAX_LINES_OPTIONS = [1_000, 10_000, 50_000, 100_000, 500_000] as const
export const PLOT_MAX_POINTS_OPTIONS = [5_000, 10_000, 50_000, 100_000, 500_000] as const

// Web Crypto is already available in the Tauri webview — no need for a
// backend round trip just to generate a random bearer token.
function generateToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

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
  /** Custom accent color (any CSS color) overriding the theme's default
   * accent in both light and dark; empty string means follow the theme's
   * built-in accent (the default). */
  accentColor: string
  keepAwake: boolean
  language: Language
  /** Whether the local REST API (see restapi::RestApiManager on the Rust
   * side) should be running — App.tsx starts/stops the actual server on
   * mount and whenever this flips, mirroring how `keepAwake` drives
   * `set_keep_awake`. Off by default: it's a control surface over local
   * hardware, even though it only ever binds to 127.0.0.1. */
  restApiEnabled: boolean
  restApiPort: number
  restApiToken: string
  /** When on, flashing (ESP32/STM32 single flash, batch flash, mass
   * production) prompts for `flashLockPin` first — a shared production
   * station can't be flashed by someone walking up to it. Off by default;
   * this is accidental/unauthorized-use prevention, not real security (the
   * PIN is stored in plain text like the REST API token above). */
  flashLockEnabled: boolean
  flashLockPin: string
  /** Set once the first-run onboarding screen has been dismissed, so it
   * only ever shows on a fresh install. */
  onboardingDone: boolean
  setEncoding: (v: Encoding) => void
  setMaxLinesPerTab: (v: number) => void
  setPlotMaxPoints: (v: number) => void
  setNewline: (v: NewlineMode) => void
  setFontSize: (v: FontSize) => void
  setTheme: (v: Theme) => void
  setAccentColor: (v: string) => void
  setKeepAwake: (v: boolean) => void
  setLanguage: (v: Language) => void
  setRestApiEnabled: (v: boolean) => void
  setRestApiPort: (v: number) => void
  regenerateRestApiToken: () => void
  setFlashLockEnabled: (v: boolean) => void
  setFlashLockPin: (v: string) => void
  setOnboardingDone: (v: boolean) => void
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
      accentColor: '',
      keepAwake: false,
      language: 'en',
      restApiEnabled: false,
      restApiPort: 8642,
      restApiToken: generateToken(),
      flashLockEnabled: false,
      flashLockPin: '',
      onboardingDone: false,
      setEncoding: (encoding) => set({ encoding }),
      setMaxLinesPerTab: (maxLinesPerTab) => set({ maxLinesPerTab }),
      setPlotMaxPoints: (plotMaxPoints) => set({ plotMaxPoints }),
      setNewline: (newline) => set({ newline }),
      setFontSize: (fontSize) => set({ fontSize }),
      setTheme: (theme) => set({ theme }),
      setAccentColor: (accentColor) => set({ accentColor }),
      setKeepAwake: (keepAwake) => set({ keepAwake }),
      setLanguage: (language) => {
        set({ language })
        void i18n.changeLanguage(language)
      },
      setRestApiEnabled: (restApiEnabled) => set({ restApiEnabled }),
      setRestApiPort: (restApiPort) => set({ restApiPort }),
      regenerateRestApiToken: () => set({ restApiToken: generateToken() }),
      setFlashLockEnabled: (flashLockEnabled) => set({ flashLockEnabled }),
      setFlashLockPin: (flashLockPin) => set({ flashLockPin }),
      setOnboardingDone: (onboardingDone) => set({ onboardingDone }),
    }),
    { name: 'edt-settings' },
  ),
)
