// Pure tree operations backing the multi-pane split layout (layoutStore).
// Kept framework/store-agnostic and unit-tested since the collapse/prune
// logic is easy to get subtly wrong (e.g. leaving a 1-child split node
// instead of collapsing it, or losing track of which tab is active).

export type SplitDirection = 'row' | 'column'
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

export interface PaneNode {
  type: 'pane'
  id: string
  tabIds: string[]
  activeTabId: string | null
}

export interface SplitNode {
  type: 'split'
  id: string
  direction: SplitDirection
  children: LayoutNode[]
  sizes: number[]
}

export type LayoutNode = PaneNode | SplitNode

let nextId = 0
export function makeNodeId(prefix: string): string {
  nextId += 1
  return `${prefix}-${Date.now()}-${nextId}`
}

export function makePane(tabIds: string[] = []): PaneNode {
  return {
    type: 'pane',
    id: makeNodeId('pane'),
    tabIds,
    activeTabId: tabIds[tabIds.length - 1] ?? null,
  }
}

export function findPane(node: LayoutNode, paneId: string): PaneNode | null {
  if (node.type === 'pane') return node.id === paneId ? node : null
  for (const child of node.children) {
    const found = findPane(child, paneId)
    if (found) return found
  }
  return null
}

export function findPaneForTab(node: LayoutNode, tabId: string): PaneNode | null {
  if (node.type === 'pane') return node.tabIds.includes(tabId) ? node : null
  for (const child of node.children) {
    const found = findPaneForTab(child, tabId)
    if (found) return found
  }
  return null
}

export function firstPaneId(node: LayoutNode): string {
  return node.type === 'pane' ? node.id : firstPaneId(node.children[0])
}

export function allPaneIds(node: LayoutNode): string[] {
  if (node.type === 'pane') return [node.id]
  return node.children.flatMap(allPaneIds)
}

/** Rebuilds the tree with `updater` applied to the pane matching `paneId`. */
export function updatePane(
  node: LayoutNode,
  paneId: string,
  updater: (pane: PaneNode) => PaneNode,
): LayoutNode {
  if (node.type === 'pane') {
    return node.id === paneId ? updater(node) : node
  }
  return { ...node, children: node.children.map((child) => updatePane(child, paneId, updater)) }
}

/** Rebuilds the tree with `updater` applied to the split matching `splitId`. */
export function updateSplit(
  node: LayoutNode,
  splitId: string,
  updater: (split: SplitNode) => SplitNode,
): LayoutNode {
  if (node.type === 'pane') return node
  const updated = node.id === splitId ? updater(node) : node
  return {
    ...updated,
    children: updated.children.map((child) => updateSplit(child, splitId, updater)),
  }
}

/** Replaces the pane matching `paneId` with a new split wrapping it and
 * `newPane`, ordered per `zone`. No-ops (returns an unchanged-by-value
 * tree) if `paneId` isn't found. */
export function splitAt(
  node: LayoutNode,
  paneId: string,
  newPane: PaneNode,
  zone: Exclude<DropZone, 'center'>,
): LayoutNode {
  if (node.type === 'pane') {
    if (node.id !== paneId) return node
    const direction: SplitDirection = zone === 'left' || zone === 'right' ? 'row' : 'column'
    const children = zone === 'left' || zone === 'top' ? [newPane, node] : [node, newPane]
    return { type: 'split', id: makeNodeId('split'), direction, children, sizes: [1, 1] }
  }
  return { ...node, children: node.children.map((child) => splitAt(child, paneId, newPane, zone)) }
}

/** Removes `tabId` from wherever it lives in the tree, collapsing any pane
 * that becomes empty and any split left with only one child. Returns
 * `null` if the whole tree collapses (the tab was the only one left
 * anywhere) — the caller should substitute a fresh empty pane. */
export function removeTab(node: LayoutNode, tabId: string): LayoutNode | null {
  if (node.type === 'pane') {
    if (!node.tabIds.includes(tabId)) return node
    const tabIds = node.tabIds.filter((id) => id !== tabId)
    if (tabIds.length === 0) return null
    const activeTabId = node.activeTabId === tabId ? tabIds[tabIds.length - 1] : node.activeTabId
    return { ...node, tabIds, activeTabId }
  }
  const nextChildren: LayoutNode[] = []
  const nextSizes: number[] = []
  node.children.forEach((child, i) => {
    const result = removeTab(child, tabId)
    if (result !== null) {
      nextChildren.push(result)
      nextSizes.push(node.sizes[i])
    }
  })
  if (nextChildren.length === 0) return null
  if (nextChildren.length === 1) return nextChildren[0]
  return { ...node, children: nextChildren, sizes: nextSizes }
}

/** Moves `tabId` out of its current pane and appends it to `targetPaneId`,
 * collapsing the source pane/split as `removeTab` would. No-ops if the tab
 * isn't found or is already the sole tab in the target pane. Returns
 * `null` only in the degenerate case where the tree had exactly one tab
 * total (source === target, nothing to move) — callers should treat that
 * the same as "no-op". */
export function moveTab(node: LayoutNode, tabId: string, targetPaneId: string): LayoutNode {
  const sourcePane = findPaneForTab(node, tabId)
  if (!sourcePane || sourcePane.id === targetPaneId) return node
  const removed = removeTab(node, tabId)
  const withoutTab = removed ?? makePane([])
  return updatePane(withoutTab, targetPaneId, (pane) => ({
    ...pane,
    tabIds: pane.tabIds.includes(tabId) ? pane.tabIds : [...pane.tabIds, tabId],
    activeTabId: tabId,
  }))
}
