import { createLibraryStore, type LibraryItem } from './createLibraryStore'

export interface SavedScript extends LibraryItem {
  code: string
}

export const useScriptLibraryStore = createLibraryStore<SavedScript>('edt-script-library')
