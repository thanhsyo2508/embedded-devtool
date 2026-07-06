import { describe, expect, it } from 'vitest'
import { buildMqttTree, filterMqttTree } from './mqttTree'

describe('buildMqttTree', () => {
  it('nests topics by / segment, sorted alphabetically at each level', () => {
    const tree = buildMqttTree({
      'home/kitchen/temp': 1,
      'home/attic/temp': 2,
      'home/kitchen/humidity': 3,
    })
    const home = tree.children[0]
    expect(home.segment).toBe('home')
    expect(home.children.map((c) => c.segment)).toEqual(['attic', 'kitchen'])
    const kitchen = home.children.find((c) => c.segment === 'kitchen')!
    expect(kitchen.children.map((c) => c.segment)).toEqual(['humidity', 'temp'])
  })

  it('lets a topic be both an internal node and a leaf', () => {
    const tree = buildMqttTree({ home: 'root-value', 'home/temp': 'leaf-value' })
    const home = tree.children[0]
    expect(home.entry).toBe('root-value')
    expect(home.children[0].entry).toBe('leaf-value')
  })

  it('tracks the full topic path at every node', () => {
    const tree = buildMqttTree({ 'a/b/c': 1 })
    const a = tree.children[0]
    const b = a.children[0]
    const c = b.children[0]
    expect([a.fullTopic, b.fullTopic, c.fullTopic]).toEqual(['a', 'a/b', 'a/b/c'])
  })
})

describe('filterMqttTree', () => {
  const tree = buildMqttTree({
    'home/kitchen/temp': 1,
    'home/attic/temp': 2,
    'office/lobby/motion': 3,
  })

  it('returns the tree unchanged for a blank query', () => {
    expect(filterMqttTree(tree, '')).toBe(tree)
  })

  it('keeps only branches matching the query plus their ancestors', () => {
    const filtered = filterMqttTree(tree, 'kitchen')
    expect(filtered.children.map((c) => c.segment)).toEqual(['home'])
    const home = filtered.children[0]
    expect(home.children.map((c) => c.segment)).toEqual(['kitchen'])
  })

  it('matches case-insensitively against the full topic path', () => {
    const filtered = filterMqttTree(tree, 'MOTION')
    expect(filtered.children.map((c) => c.segment)).toEqual(['office'])
  })

  it('drops everything when nothing matches', () => {
    const filtered = filterMqttTree(tree, 'nonexistent')
    expect(filtered.children).toEqual([])
  })
})
