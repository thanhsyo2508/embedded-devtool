import { createLibraryStore, type LibraryItem } from './createLibraryStore'

export interface QuickCommand {
  id: string
  label: string
  text: string
  isHex: boolean
}

export interface QuickCommandProfile extends LibraryItem {
  commands: QuickCommand[]
}

export const useQuickCommandProfilesStore = createLibraryStore<QuickCommandProfile>(
  'edt-quick-command-profiles',
)
