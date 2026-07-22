/** Reads a value out of a parsed JSON tree by dot-separated path (array
 * indices are plain numeric segments, e.g. "items.0.value") — lets a field
 * picked once from an MQTT payload be re-extracted from every later message
 * on the same topic, without re-parsing the whole object by hand. */
export function getByPath(value: unknown, path: string): unknown {
  if (path.length === 0) return value
  let current: unknown = value
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}
