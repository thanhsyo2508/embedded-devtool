import type { ReactNode } from 'react'

function toGlobalRegex(re: RegExp): RegExp {
  return re.flags.includes('g') ? re : new RegExp(re.source, re.flags + 'g')
}

function matchRanges(text: string, patterns: RegExp[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const pattern of patterns) {
    const re = toGlobalRegex(pattern)
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      if (m[0].length === 0) {
        re.lastIndex++
        continue
      }
      ranges.push([m.index, m.index + m[0].length])
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1])
    } else {
      merged.push(range)
    }
  }
  return merged
}

/** Wraps every substring of `text` matched by any of `patterns` in a `<mark>`. */
export function highlightMatches(text: string, patterns: RegExp[]): ReactNode {
  if (patterns.length === 0) return text
  const ranges = matchRanges(text, patterns)
  if (ranges.length === 0) return text

  const parts: ReactNode[] = []
  let cursor = 0
  ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(<mark key={i}>{text.slice(start, end)}</mark>)
    cursor = end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}
