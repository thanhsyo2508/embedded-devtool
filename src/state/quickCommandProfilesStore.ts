import { createLibraryStore, type LibraryItem } from './createLibraryStore'
import type { LineEnding } from './tabsStore'

export interface QuickCommand {
  id: string
  label: string
  text: string
  isHex: boolean
  /** Overrides the tab's Line Ending setting for this command only —
   * undefined means "inherit the tab's current setting", same as before
   * this field existed. */
  lineEnding?: LineEnding
}

export interface QuickCommandProfile extends LibraryItem {
  commands: QuickCommand[]
}

export const useQuickCommandProfilesStore = createLibraryStore<QuickCommandProfile>(
  'edt-quick-command-profiles',
)
