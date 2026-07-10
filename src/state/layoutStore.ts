import { create } from 'zustand'
import {
  findPane,
  firstPaneId,
  makePane,
  moveTab,
  removeTab,
  splitAt,
  updatePane,
  updateSplit,
  type DropZone,
  type LayoutNode,
} from '../lib/layoutTree'

// Resolves to `focusedPaneId` when it still exists in the (possibly just
// mutated) tree, otherwise falls back to the first pane — panes can vanish
// out from under the focus pointer whenever a close/move collapses them.
function resolveFocus(root: LayoutNode, focusedPaneId: string): string {
  return findPane(root, focusedPaneId) ? focusedPaneId : firstPaneId(root)
}

interface LayoutState {
  root: LayoutNode
  focusedPaneId: string
  focusPane: (paneId: string) => void
  openTabInFocusedPane: (tabId: string) => void
  setActiveTabInPane: (paneId: string, tabId: string) => void
  closeTab: (tabId: string) => void
  moveTabToPane: (tabId: string, targetPaneId: string) => void
  splitPaneWithTab: (targetPaneId: string, tabId: string, zone: DropZone) => void
  resizeSplit: (splitId: string, index: number, sizeA: number, sizeB: number) => void
  /** Replaces the whole tree wholesale — for restoring a saved project
   * profile's layout, once its tabs are open under their new runtime ids. */
  loadLayout: (root: LayoutNode) => void
}

const initialPane = makePane([])

export const useLayoutStore = create<LayoutState>((set) => ({
  root: initialPane,
  focusedPaneId: initialPane.id,

  focusPane: (paneId) => set({ focusedPaneId: paneId }),

  openTabInFocusedPane: (tabId) =>
    set((state) => {
      const paneId = resolveFocus(state.root, state.focusedPaneId)
      return {
        root: updatePane(state.root, paneId, (pane) => ({
          ...pane,
          tabIds: pane.tabIds.includes(tabId) ? pane.tabIds : [...pane.tabIds, tabId],
          activeTabId: tabId,
        })),
        focusedPaneId: paneId,
      }
    }),

  setActiveTabInPane: (paneId, tabId) =>
    set((state) => ({
      root: updatePane(state.root, paneId, (pane) => ({ ...pane, activeTabId: tabId })),
      focusedPaneId: paneId,
    })),

  closeTab: (tabId) =>
    set((state) => {
      const root = removeTab(state.root, tabId) ?? makePane([])
      return { root, focusedPaneId: resolveFocus(root, state.focusedPaneId) }
    }),

  moveTabToPane: (tabId, targetPaneId) =>
    set((state) => {
      const root = moveTab(state.root, tabId, targetPaneId)
      return { root, focusedPaneId: resolveFocus(root, targetPaneId) }
    }),

  splitPaneWithTab: (targetPaneId, tabId, zone) =>
    set((state) => {
      if (zone === 'center') {
        const root = moveTab(state.root, tabId, targetPaneId)
        return { root, focusedPaneId: resolveFocus(root, targetPaneId) }
      }
      const targetPane = findPane(state.root, targetPaneId)
      // Dragging a pane's only tab onto an edge of that same pane has
      // nothing left to split from once the tab is pulled out — no-op
      // rather than leaving an empty pane behind.
      const selfSplitWithNothingLeft =
        targetPane?.tabIds.length === 1 && targetPane.tabIds[0] === tabId
      if (selfSplitWithNothingLeft) return state
      const withoutTab = removeTab(state.root, tabId) ?? state.root
      const newPane = makePane([tabId])
      const root = splitAt(withoutTab, targetPaneId, newPane, zone)
      return { root, focusedPaneId: newPane.id }
    }),

  resizeSplit: (splitId, index, sizeA, sizeB) =>
    set((state) => ({
      root: updateSplit(state.root, splitId, (split) => {
        const sizes = [...split.sizes]
        sizes[index] = sizeA
        sizes[index + 1] = sizeB
        return { ...split, sizes }
      }),
    })),

  loadLayout: (root) => set({ root, focusedPaneId: firstPaneId(root) }),
}))
