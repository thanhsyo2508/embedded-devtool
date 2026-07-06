import type { MqttTreeNode } from '../lib/mqttTree'
import type { MqttTopicEntry } from '../state/mqttStore'

interface RowProps {
  node: MqttTreeNode<MqttTopicEntry>
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  selectedTopic: string | null
  onSelect: (path: string) => void
  forceExpand: boolean
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  selectedTopic,
  onSelect,
  forceExpand,
}: RowProps) {
  const hasChildren = node.children.length > 0
  const isExpanded = forceExpand || expanded.has(node.fullTopic)
  const hasMessage = node.entry !== null
  const history = node.entry?.history
  const latest = history && history.length > 0 ? history[history.length - 1] : null

  return (
    <>
      <div
        className={`mqtt-tree-row ${selectedTopic === node.fullTopic ? 'on' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 6}px` }}
        onClick={() => {
          if (hasMessage) onSelect(node.fullTopic)
          else if (hasChildren) onToggle(node.fullTopic)
        }}
      >
        {hasChildren ? (
          <span
            className="mqtt-tree-toggle"
            onClick={(e) => {
              e.stopPropagation()
              onToggle(node.fullTopic)
            }}
          >
            {isExpanded ? '▾' : '▸'}
          </span>
        ) : (
          <span className="mqtt-tree-toggle mqtt-tree-toggle-spacer" />
        )}
        <span className="mono mqtt-tree-segment">{node.segment}</span>
        {hasMessage && (
          <>
            {latest?.retain && (
              <span className="mqtt-tree-badge" title="Retained">
                R
              </span>
            )}
            <span className="mqtt-tree-count">{node.entry!.messageCount}</span>
          </>
        )}
      </div>
      {hasChildren &&
        isExpanded &&
        node.children.map((child) => (
          <TreeRow
            key={child.fullTopic}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            selectedTopic={selectedTopic}
            onSelect={onSelect}
            forceExpand={forceExpand}
          />
        ))}
    </>
  )
}

export function MqttTopicTree({
  root,
  expanded,
  onToggle,
  selectedTopic,
  onSelect,
  forceExpand,
}: {
  root: MqttTreeNode<MqttTopicEntry>
  expanded: Set<string>
  onToggle: (path: string) => void
  selectedTopic: string | null
  onSelect: (path: string) => void
  forceExpand: boolean
}) {
  if (root.children.length === 0) {
    return <p className="mdns-empty">No messages received yet.</p>
  }
  return (
    <div className="mqtt-tree">
      {root.children.map((child) => (
        <TreeRow
          key={child.fullTopic}
          node={child}
          depth={0}
          expanded={expanded}
          onToggle={onToggle}
          selectedTopic={selectedTopic}
          onSelect={onSelect}
          forceExpand={forceExpand}
        />
      ))}
    </div>
  )
}
