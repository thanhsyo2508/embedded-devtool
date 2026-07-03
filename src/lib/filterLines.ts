import type { FilterRule, LogLine } from '../state/tabsStore'

export function compileFilter(rule: FilterRule): RegExp | null {
  if (!rule.enabled || rule.pattern.length === 0) return null
  try {
    return new RegExp(rule.pattern, 'i')
  } catch {
    return null
  }
}

export function applyFilters(lines: LogLine[], filters: FilterRule[]): LogLine[] {
  const includes = filters
    .filter((f) => f.mode === 'include')
    .map(compileFilter)
    .filter((re): re is RegExp => re !== null)
  const excludes = filters
    .filter((f) => f.mode === 'exclude')
    .map(compileFilter)
    .filter((re): re is RegExp => re !== null)

  if (includes.length === 0 && excludes.length === 0) return lines

  return lines.filter((line) => {
    if (excludes.some((re) => re.test(line.text))) return false
    if (includes.length > 0 && !includes.some((re) => re.test(line.text))) return false
    return true
  })
}
