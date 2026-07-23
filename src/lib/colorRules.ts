import type { ColorRule } from '../state/tabsStore'

export interface CompiledColorRule {
  re: RegExp
  color: string
}

/** Compiles the enabled, valid rules once (an invalid regex is dropped, not
 * thrown) so the per-line lookup below can run on every visible log row
 * without rebuilding a `new RegExp` each time. */
export function compileColorRules(rules: ColorRule[]): CompiledColorRule[] {
  const compiled: CompiledColorRule[] = []
  for (const rule of rules) {
    if (!rule.enabled || rule.pattern.length === 0) continue
    try {
      compiled.push({ re: new RegExp(rule.pattern, 'i'), color: rule.color })
    } catch {
      // invalid pattern while the user is still typing — just skip it
    }
  }
  return compiled
}

/** The colour of the first matching rule, or null when nothing matches
 * (the line then keeps its default log-level colour). */
export function matchColor(text: string, compiled: CompiledColorRule[]): string | null {
  for (const rule of compiled) {
    if (rule.re.test(text)) return rule.color
  }
  return null
}
