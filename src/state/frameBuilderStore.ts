import { create } from 'zustand'
import { newFrameField, type FrameField } from '../lib/frameBuilder'

interface FrameBuilderState {
  /** Draft frame fields per tab id. In-memory for the session (survives
   * toggling the panel closed/open, which unmounts the component) but not a
   * restart — a frame draft is a scratch composition, not saved config. */
  fieldsByTab: Record<string, FrameField[]>
  setFields: (tabId: string, fields: FrameField[]) => void
}

export const useFrameBuilderStore = create<FrameBuilderState>((set) => ({
  fieldsByTab: {},
  setFields: (tabId, fields) =>
    set((state) => ({ fieldsByTab: { ...state.fieldsByTab, [tabId]: fields } })),
}))

/** A fresh starter frame (one hex field) for a tab that has no draft yet —
 * a module constant so the fallback reference is stable across renders. */
export const DEFAULT_FRAME_FIELDS: FrameField[] = [newFrameField('hex')]
