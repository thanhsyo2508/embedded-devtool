// Detects duplicate sibling keys in a JSON document — something `JSON.parse`
// silently hides (a later key of the same name in the same object wins, the
// earlier one vanishes). That exact footgun shipped a real bug once: two
// `help.productionStats`/`help.configBackup` blocks, one nested and one at
// root, where the root duplicate shadowed the nested one and its Help
// section stopped resolving. The i18n test uses this to fail the build if
// it happens again.
//
// This is a small structural tokenizer, not a full validator — it assumes
// the input already parses as JSON (the caller runs it alongside
// `JSON.parse`), and only tracks enough state to tell a key string from a
// value string so it can flag a repeated key within one object.

interface Frame {
  isObject: boolean
  path: string
  seen: Set<string>
  /** For objects: where we are in the `key : value ,` cycle. Arrays only
   * ever alternate value/comma, so `pendingKey` is unused for them. */
  mode: 'key' | 'colon' | 'value' | 'comma'
  pendingKey: string
}

/** Returns the dotted paths of every duplicated key found (empty when the
 * document has none). A path like `help.flashStm32.heading` names the
 * offending key and the object it repeats in. */
export function findDuplicateKeys(text: string): string[] {
  const duplicates: string[] = []
  const stack: Frame[] = []
  const stringRe = /"(?:[^"\\]|\\.)*"/y
  // A run of non-structural characters (number / true / false / null) — we
  // don't care about its value, only that it ends a "value" position.
  const bareRe = /[^{}[\]:,"\s]+/y

  const top = (): Frame | undefined => stack[stack.length - 1]

  const childPath = (parent: Frame | undefined): string => {
    if (!parent) return ''
    if (parent.isObject) {
      return parent.path ? `${parent.path}.${parent.pendingKey}` : parent.pendingKey
    }
    return `${parent.path}[]`
  }

  // After any completed value (a scalar, or a just-popped object/array), the
  // enclosing frame moves to expecting a comma or its closing bracket.
  const valueCompleted = () => {
    const frame = top()
    if (frame) frame.mode = 'comma'
  }

  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      i++
      continue
    }

    if (ch === '{' || ch === '[') {
      const parent = top()
      stack.push({
        isObject: ch === '{',
        path: childPath(parent),
        seen: new Set(),
        mode: ch === '{' ? 'key' : 'value',
        pendingKey: '',
      })
      i++
      continue
    }

    if (ch === '}' || ch === ']') {
      stack.pop()
      valueCompleted()
      i++
      continue
    }

    if (ch === ':') {
      const frame = top()
      if (frame) frame.mode = 'value'
      i++
      continue
    }

    if (ch === ',') {
      const frame = top()
      if (frame) frame.mode = frame.isObject ? 'key' : 'value'
      i++
      continue
    }

    if (ch === '"') {
      stringRe.lastIndex = i
      const match = stringRe.exec(text)
      if (!match) {
        i++
        continue
      }
      const raw = match[0]
      const frame = top()
      if (frame?.isObject && frame.mode === 'key') {
        const key = JSON.parse(raw) as string
        if (frame.seen.has(key)) {
          duplicates.push(frame.path ? `${frame.path}.${key}` : key)
        }
        frame.seen.add(key)
        frame.pendingKey = key
        frame.mode = 'colon'
      } else {
        valueCompleted()
      }
      i = stringRe.lastIndex
      continue
    }

    // A bare scalar value (number / true / false / null).
    bareRe.lastIndex = i
    const bare = bareRe.exec(text)
    if (bare && bare[0].length > 0) {
      valueCompleted()
      i = bareRe.lastIndex
    } else {
      i++
    }
  }

  return duplicates
}

/** Flattens a parsed JSON object to the set of its leaf key paths — used to
 * compare two locale files for missing/extra keys. */
export function flattenKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix]
  }
  const out: string[] = []
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    out.push(...flattenKeys(child, path))
  }
  return out
}
