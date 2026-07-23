import { createLibraryStore, type LibraryItem } from './createLibraryStore'

/** A named, reusable struct-decode template (see lib/structDecode) — saved
 * so a binary frame layout you decode often doesn't have to be retyped. */
export interface StructTemplate extends LibraryItem {
  template: string
}

export const useStructTemplateStore = createLibraryStore<StructTemplate>('edt-struct-templates')
