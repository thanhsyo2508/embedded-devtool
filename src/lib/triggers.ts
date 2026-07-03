import type { LogLine, TriggerRule } from '../state/tabsStore'

export interface TriggerMatch {
  rule: TriggerRule
  line: LogLine
}

export function matchTriggers(triggers: TriggerRule[], lines: LogLine[]): TriggerMatch[] {
  const matches: TriggerMatch[] = []
  for (const rule of triggers) {
    if (!rule.enabled || rule.pattern.length === 0) continue
    let re: RegExp
    try {
      re = new RegExp(rule.pattern, 'i')
    } catch {
      continue
    }
    for (const line of lines) {
      if (re.test(line.text)) matches.push({ rule, line })
    }
  }
  return matches
}
