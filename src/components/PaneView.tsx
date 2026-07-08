import { Fragment } from 'react'
import type { LayoutNode } from '../lib/layoutTree'
import { PaneContent } from './PaneContent'
import { SplitResizer } from './SplitResizer'

// Recursive renderer for the split tree: a SplitNode becomes a flex row/
// column of its children with a resizer between each adjacent pair, a
// PaneNode delegates to PaneContent. The resizer must be a DOM sibling of
// the two items it resizes (see SplitResizer), hence the Fragment shape.
export function PaneView({ node, onAddClick }: { node: LayoutNode; onAddClick: () => void }) {
  if (node.type === 'pane') {
    return <PaneContent pane={node} onAddClick={onAddClick} />
  }

  return (
    <div className={`pane-split pane-split-${node.direction}`}>
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && (
            <SplitResizer
              splitId={node.id}
              index={i - 1}
              direction={node.direction}
              sizeA={node.sizes[i - 1]}
              sizeB={node.sizes[i]}
            />
          )}
          <div className="pane-split-item" style={{ flexGrow: node.sizes[i], flexBasis: 0 }}>
            <PaneView node={child} onAddClick={onAddClick} />
          </div>
        </Fragment>
      ))}
    </div>
  )
}
