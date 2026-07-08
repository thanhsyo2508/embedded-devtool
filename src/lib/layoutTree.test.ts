import { describe, expect, it } from 'vitest'
import {
  findPane,
  findPaneForTab,
  makePane,
  moveTab,
  removeTab,
  splitAt,
  updatePane,
  type LayoutNode,
} from './layoutTree'

describe('findPane / findPaneForTab', () => {
  it('finds a pane by id in a nested split', () => {
    const leftPane = makePane(['a'])
    const rightPane = makePane(['b'])
    const tree: LayoutNode = {
      type: 'split',
      id: 'split-1',
      direction: 'row',
      children: [leftPane, rightPane],
      sizes: [1, 1],
    }
    expect(findPane(tree, rightPane.id)).toBe(rightPane)
    expect(findPane(tree, 'missing')).toBeNull()
  })

  it('finds the pane holding a given tab id', () => {
    const leftPane = makePane(['a'])
    const rightPane = makePane(['b'])
    const tree: LayoutNode = {
      type: 'split',
      id: 'split-1',
      direction: 'row',
      children: [leftPane, rightPane],
      sizes: [1, 1],
    }
    expect(findPaneForTab(tree, 'b')).toBe(rightPane)
    expect(findPaneForTab(tree, 'missing')).toBeNull()
  })
})

describe('updatePane', () => {
  it('only rebuilds the targeted pane, leaving siblings referentially untouched', () => {
    const leftPane = makePane(['a'])
    const rightPane = makePane(['b'])
    const tree: LayoutNode = {
      type: 'split',
      id: 'split-1',
      direction: 'row',
      children: [leftPane, rightPane],
      sizes: [1, 1],
    }
    const next = updatePane(tree, leftPane.id, (pane) => ({ ...pane, activeTabId: 'a' }))
    if (next.type !== 'split') throw new Error('expected split')
    expect(next.children[0]).not.toBe(leftPane)
    expect(next.children[1]).toBe(rightPane)
  })
})

describe('splitAt', () => {
  it('wraps the target pane in a row split, ordering children by zone=left', () => {
    const pane = makePane(['a'])
    const newPane = makePane(['b'])
    const next = splitAt(pane, pane.id, newPane, 'left')
    if (next.type !== 'split') throw new Error('expected split')
    expect(next.direction).toBe('row')
    expect(next.children).toEqual([newPane, pane])
  })

  it('wraps the target pane in a row split, ordering children by zone=right', () => {
    const pane = makePane(['a'])
    const newPane = makePane(['b'])
    const next = splitAt(pane, pane.id, newPane, 'right')
    if (next.type !== 'split') throw new Error('expected split')
    expect(next.direction).toBe('row')
    expect(next.children).toEqual([pane, newPane])
  })

  it('wraps the target pane in a column split for top/bottom zones', () => {
    const pane = makePane(['a'])
    const newPane = makePane(['b'])
    const top = splitAt(pane, pane.id, newPane, 'top')
    if (top.type !== 'split') throw new Error('expected split')
    expect(top.direction).toBe('column')
    expect(top.children).toEqual([newPane, pane])

    const bottom = splitAt(pane, pane.id, newPane, 'bottom')
    if (bottom.type !== 'split') throw new Error('expected split')
    expect(bottom.children).toEqual([pane, newPane])
  })

  it('recurses into nested splits to find the target pane', () => {
    const leftPane = makePane(['a'])
    const rightPane = makePane(['b'])
    const tree: LayoutNode = {
      type: 'split',
      id: 'split-1',
      direction: 'row',
      children: [leftPane, rightPane],
      sizes: [1, 1],
    }
    const newPane = makePane(['c'])
    const next = splitAt(tree, rightPane.id, newPane, 'bottom')
    if (next.type !== 'split') throw new Error('expected outer split')
    const splitRight = next.children[1]
    if (splitRight.type !== 'split') throw new Error('expected inner split')
    expect(splitRight.direction).toBe('column')
    expect(splitRight.children).toEqual([rightPane, newPane])
  })

  it('is a no-op (by value) when the target pane id does not exist', () => {
    const pane = makePane(['a'])
    const newPane = makePane(['b'])
    const next = splitAt(pane, 'missing', newPane, 'left')
    expect(next).toEqual(pane)
  })
})

describe('removeTab', () => {
  it('removes a tab from a pane holding multiple tabs, keeping the pane', () => {
    const pane = makePane(['a', 'b'])
    const next = removeTab(pane, 'a')
    expect(next).toEqual({ type: 'pane', id: pane.id, tabIds: ['b'], activeTabId: 'b' })
  })

  it('reassigns activeTabId when the removed tab was active', () => {
    const pane: LayoutNode = { type: 'pane', id: 'p1', tabIds: ['a', 'b'], activeTabId: 'b' }
    const next = removeTab(pane, 'b')
    if (!next || next.type !== 'pane') throw new Error('expected pane')
    expect(next.activeTabId).toBe('a')
  })

  it('collapses a pane that loses its last tab, and its parent split down to the sibling', () => {
    const leftPane = makePane(['a'])
    const rightPane = makePane(['b'])
    const tree: LayoutNode = {
      type: 'split',
      id: 'split-1',
      direction: 'row',
      children: [leftPane, rightPane],
      sizes: [1, 1],
    }
    const next = removeTab(tree, 'a')
    expect(next).toEqual(rightPane)
  })

  it('keeps a 3-way split with 2 children after one pane empties', () => {
    const a = makePane(['a'])
    const b = makePane(['b'])
    const c = makePane(['c'])
    const tree: LayoutNode = {
      type: 'split',
      id: 'split-1',
      direction: 'row',
      children: [a, b, c],
      sizes: [1, 1, 1],
    }
    const next = removeTab(tree, 'b')
    if (!next || next.type !== 'split') throw new Error('expected split')
    expect(next.children).toEqual([a, c])
    expect(next.sizes).toEqual([1, 1])
  })

  it('returns null when removing the only tab in the whole tree', () => {
    const pane = makePane(['a'])
    expect(removeTab(pane, 'a')).toBeNull()
  })

  it('is a no-op when the tab id is not present anywhere', () => {
    const pane = makePane(['a'])
    expect(removeTab(pane, 'missing')).toEqual(pane)
  })
})

describe('moveTab', () => {
  it('moves a tab from one pane to another, focusing it there', () => {
    const leftPane = makePane(['a', 'b'])
    const rightPane = makePane(['c'])
    const tree: LayoutNode = {
      type: 'split',
      id: 'split-1',
      direction: 'row',
      children: [leftPane, rightPane],
      sizes: [1, 1],
    }
    const next = moveTab(tree, 'b', rightPane.id)
    if (next.type !== 'split') throw new Error('expected split')
    expect(next.children[0]).toEqual({
      type: 'pane',
      id: leftPane.id,
      tabIds: ['a'],
      activeTabId: 'a',
    })
    expect(next.children[1]).toEqual({
      type: 'pane',
      id: rightPane.id,
      tabIds: ['c', 'b'],
      activeTabId: 'b',
    })
  })

  it('collapses the source split when the moved tab was its last', () => {
    const leftPane = makePane(['a'])
    const rightPane = makePane(['b'])
    const tree: LayoutNode = {
      type: 'split',
      id: 'split-1',
      direction: 'row',
      children: [leftPane, rightPane],
      sizes: [1, 1],
    }
    const next = moveTab(tree, 'a', rightPane.id)
    expect(next).toEqual({ type: 'pane', id: rightPane.id, tabIds: ['b', 'a'], activeTabId: 'a' })
  })

  it('is a no-op when the tab is already the only tab in the target pane', () => {
    const pane = makePane(['a'])
    expect(moveTab(pane, 'a', pane.id)).toBe(pane)
  })

  it('is a no-op when the tab id is not found', () => {
    const leftPane = makePane(['a'])
    const rightPane = makePane(['b'])
    const tree: LayoutNode = {
      type: 'split',
      id: 'split-1',
      direction: 'row',
      children: [leftPane, rightPane],
      sizes: [1, 1],
    }
    expect(moveTab(tree, 'missing', rightPane.id)).toBe(tree)
  })
})
