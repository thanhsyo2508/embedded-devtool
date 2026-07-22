import type { FilterRule, LogLine } from '../state/tabsStore'

export function compileFilter(rule: FilterRule): RegExp | null {
  if (!rule.enabled || rule.pattern.length === 0) return null
  try {
    return new RegExp(rule.pattern, 'i')
  } catch {
    return null
  }
}

export interface CompiledFilters {
  includes: RegExp[]
  excludes: RegExp[]
}

/** Compiles a rule set into its include/exclude regex lists once, so the
 * per-line `applyCompiledFilters` below doesn't rebuild a `new RegExp` for
 * every rule on every call — that recompilation, run on each ~60fps data
 * batch by the live log view, is pure waste since the rules only change
 * when the user edits them. */
export function compileFilters(filters: FilterRule[]): CompiledFilters {
  const includes = filters
    .filter((f) => f.mode === 'include')
    .map(compileFilter)
    .filter((re): re is RegExp => re !== null)
  const excludes = filters
    .filter((f) => f.mode === 'exclude')
    .map(compileFilter)
    .filter((re): re is RegExp => re !== null)
  return { includes, excludes }
}

export function applyCompiledFilters(lines: LogLine[], { includes, excludes }: CompiledFilters) {
  if (includes.length === 0 && excludes.length === 0) return lines
  return lines.filter((line) => {
    if (excludes.some((re) => re.test(line.text))) return false
    if (includes.length > 0 && !includes.some((re) => re.test(line.text))) return false
    return true
  })
}

export function applyFilters(lines: LogLine[], filters: FilterRule[]): LogLine[] {
  return applyCompiledFilters(lines, compileFilters(filters))
}
