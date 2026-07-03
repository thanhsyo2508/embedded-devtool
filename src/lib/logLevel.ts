export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose'

// ESP-IDF often wraps the whole line in an ANSI color code
// (e.g. "\x1b[0;31mE (328) wifi: ...\x1b[0m") — strip a leading one before
// matching so color doesn't hide the level letter from the regexes below.
// eslint-disable-next-line no-control-regex -- intentionally matching the ANSI escape byte
const ANSI_PREFIX = /^\x1b\[[0-9;]*m/
const ESP_IDF = /^([EWIDV])\s?\(\d+\)/
const BRACKET = /^\[(ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE)\]/i
const PREFIX = /^(ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE)\b[:\s]/i

const LETTER_TO_LEVEL: Record<string, LogLevel> = {
  E: 'error',
  W: 'warn',
  I: 'info',
  D: 'debug',
  V: 'verbose',
}

const WORD_TO_LEVEL: Record<string, LogLevel> = {
  ERROR: 'error',
  WARN: 'warn',
  WARNING: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  TRACE: 'verbose',
}

export function detectLogLevel(text: string): LogLevel | null {
  const s = text.replace(ANSI_PREFIX, '')
  const esp = ESP_IDF.exec(s)
  if (esp) return LETTER_TO_LEVEL[esp[1]]
  const bracket = BRACKET.exec(s)
  if (bracket) return WORD_TO_LEVEL[bracket[1].toUpperCase()]
  const prefix = PREFIX.exec(s)
  if (prefix) return WORD_TO_LEVEL[prefix[1].toUpperCase()]
  return null
}
