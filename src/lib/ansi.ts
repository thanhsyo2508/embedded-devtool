/** Minimal ANSI SGR (color) parser for the monitor — ESP-IDF, Zephyr and
 * most RTOS log output wraps lines in `\x1b[...m` color codes, which would
 * otherwise render as invisible/garbage control chars. This turns them into
 * styled text runs; non-color escape sequences (cursor moves, clears) are
 * stripped. Only the common 16-color palette plus bold/underline are
 * handled — enough for log coloring, not a full terminal emulator. */

export interface AnsiStyle {
  fg?: string
  bold?: boolean
  underline?: boolean
}

export interface AnsiSegment {
  text: string
  style: AnsiStyle
}

// Standard 16-color palette, chosen to stay legible on both light and dark
// themes (the plain foreground stays as the theme's text color).
const BASIC: Record<number, string> = {
  30: '#555555',
  31: '#c0392b',
  32: '#27916b',
  33: '#b7791f',
  34: '#2b6cb0',
  35: '#9b59b6',
  36: '#2596a3',
  37: '#aaaaaa',
}
const BRIGHT: Record<number, string> = {
  90: '#777777',
  91: '#e74c3c',
  92: '#2ecc71',
  93: '#d4a017',
  94: '#4a90d9',
  95: '#c471d4',
  96: '#3bc9db',
  97: '#eeeeee',
}

// SGR sequences (`...m`) plus any other CSI sequence (which we strip).
// eslint-disable-next-line no-control-regex -- matching the ANSI escape byte is the point
const CSI = /\x1b\[([0-9;]*)([A-Za-z])/g

function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  const codes = params === '' ? [0] : params.split(';').map((p) => Number(p))
  let next: AnsiStyle = { ...style }
  for (const code of codes) {
    if (code === 0)
      next = {} // full reset — a fresh, un-styled run
    else if (code === 1) next.bold = true
    else if (code === 22) next.bold = false
    else if (code === 4) next.underline = true
    else if (code === 24) next.underline = false
    else if (code === 39) next.fg = undefined
    else if (BASIC[code]) next.fg = BASIC[code]
    else if (BRIGHT[code]) next.fg = BRIGHT[code]
  }
  return next
}

/** Splits `text` into consecutively-styled runs. When the text has no
 * escape sequences at all, returns a single un-styled segment (the common
 * case), so callers can cheaply detect "nothing to colorize". */
export function parseAnsi(text: string): AnsiSegment[] {
  if (!text.includes('\x1b')) return [{ text, style: {} }]

  const segments: AnsiSegment[] = []
  let style: AnsiStyle = {}
  let cursor = 0
  const re = new RegExp(CSI)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > cursor) {
      segments.push({ text: text.slice(cursor, m.index), style })
    }
    if (m[2] === 'm') style = applySgr(style, m[1])
    // else: a non-color CSI sequence — stripped by advancing past it.
    cursor = m.index + m[0].length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), style })

  return segments.filter((s) => s.text.length > 0)
}

export function ansiStyleToCss(style: AnsiStyle): React.CSSProperties | undefined {
  const css: React.CSSProperties = {}
  if (style.fg) css.color = style.fg
  if (style.bold) css.fontWeight = 600
  if (style.underline) css.textDecoration = 'underline'
  return Object.keys(css).length > 0 ? css : undefined
}
