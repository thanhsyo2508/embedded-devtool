/** Tokenizes a JSON string for syntax highlighting — deliberately a single
 * regex pass over the already-valid, already-pretty-printed text rather than
 * a real parser, since all we need is "which substrings are which kind of
 * token" for coloring, not a value tree. */

export type JsonTokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null'

export interface JsonToken {
  text: string
  /** null means punctuation/whitespace — rendered without special styling. */
  kind: JsonTokenKind | null
}

const TOKEN_RE =
  /"(?:\\.|[^"\\])*"(?:\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g

export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = []
  const re = new RegExp(TOKEN_RE)
  let cursor = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > cursor) tokens.push({ text: text.slice(cursor, m.index), kind: null })
    const matched = m[0]
    const kind: JsonTokenKind = matched.startsWith('"')
      ? /:\s*$/.test(matched)
        ? 'key'
        : 'string'
      : matched === 'true' || matched === 'false'
        ? 'boolean'
        : matched === 'null'
          ? 'null'
          : 'number'
    tokens.push({ text: matched, kind })
    cursor = re.lastIndex
  }
  if (cursor < text.length) tokens.push({ text: text.slice(cursor), kind: null })
  return tokens
}
