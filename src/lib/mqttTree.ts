/** Builds a `/`-segmented topic tree out of a flat `{topic: entry}` map, the
 * way MQTT Explorer/MQTTX present subscriptions — a topic can be both an
 * internal node and a leaf (e.g. both "home" and "home/temp" have received
 * messages), hence `entry` living on every node rather than only leaves. */

export interface MqttTreeNode<T> {
  segment: string
  fullTopic: string
  children: MqttTreeNode<T>[]
  entry: T | null
}

interface MutableNode<T> {
  segment: string
  fullTopic: string
  children: Map<string, MutableNode<T>>
  entry: T | null
}

function toSorted<T>(node: MutableNode<T>): MqttTreeNode<T> {
  const children = Array.from(node.children.values())
    .map(toSorted)
    .sort((a, b) => a.segment.localeCompare(b.segment))
  return { segment: node.segment, fullTopic: node.fullTopic, children, entry: node.entry }
}

export function buildMqttTree<T>(entries: Record<string, T>): MqttTreeNode<T> {
  const root: MutableNode<T> = { segment: '', fullTopic: '', children: new Map(), entry: null }
  for (const topic of Object.keys(entries)) {
    let node = root
    let path = ''
    for (const part of topic.split('/')) {
      path = path ? `${path}/${part}` : part
      let child = node.children.get(part)
      if (!child) {
        child = { segment: part, fullTopic: path, children: new Map(), entry: null }
        node.children.set(part, child)
      }
      node = child
    }
    node.entry = entries[topic]
  }
  return toSorted(root)
}

/** Prunes the tree down to nodes whose full topic path contains `query`
 * (case-insensitive) plus their ancestors — a node survives if it matches
 * itself or any descendant does. Returns the tree unchanged when `query`
 * is blank. */
export function filterMqttTree<T>(node: MqttTreeNode<T>, query: string): MqttTreeNode<T> {
  const q = query.trim().toLowerCase()
  if (!q) return node

  function prune(n: MqttTreeNode<T>): MqttTreeNode<T> | null {
    const children = n.children.map(prune).filter((c): c is MqttTreeNode<T> => c !== null)
    const selfMatch = n.fullTopic.toLowerCase().includes(q)
    if (!selfMatch && children.length === 0) return null
    return { ...n, children }
  }

  return {
    ...node,
    children: node.children.map(prune).filter((c): c is MqttTreeNode<T> => c !== null),
  }
}
