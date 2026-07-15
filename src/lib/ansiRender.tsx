import type { ReactNode } from 'react'
import { parseAnsi, ansiStyleToCss } from './ansi'
import { highlightMatches } from './highlight'

/** Renders a log line's text with ANSI colors applied and search/filter
 * matches highlighted. Search highlighting runs per color-run rather than
 * across the whole line, so a match that straddles a color change is
 * highlighted in each part — an acceptable approximation that keeps this
 * simple, since color changes rarely fall mid-word. */
export function renderLine(text: string, patterns: RegExp[]): ReactNode {
  const segments = parseAnsi(text)

  // Fast path: the overwhelmingly common no-ANSI line renders exactly as it
  // did before (a bare highlighted string, no wrapper spans).
  if (segments.length === 1 && !ansiStyleToCss(segments[0].style)) {
    return highlightMatches(segments[0].text, patterns)
  }

  return segments.map((seg, i) => {
    const css = ansiStyleToCss(seg.style)
    const inner = highlightMatches(seg.text, patterns)
    return css ? (
      <span key={i} style={css}>
        {inner}
      </span>
    ) : (
      <span key={i}>{inner}</span>
    )
  })
}
