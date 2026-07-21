import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-lua'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-ini'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-c'
// cpp/typescript extend c/javascript respectively — must load after them.
import 'prismjs/components/prism-cpp'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-toml'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'

const EXTENSION_TO_GRAMMAR: Record<string, string> = {
  lua: 'lua',
  json: 'json',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  md: 'markdown',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  rs: 'rust',
  toml: 'toml',
  xml: 'markup',
  html: 'markup',
  htm: 'markup',
  svg: 'markup',
  css: 'css',
  js: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
}

function escapeHtml(code: string): string {
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Matches one `search-match` token span's opening tag, in the exact form
 * `highlightForPath`'s own combined grammar produces below (a plain
 * `search-match` grammar key with no `alias`, so Prism always renders it as
 * `class="token search-match"`, nothing more, nothing reordered). */
const SEARCH_MATCH_SPAN_OPEN = /<span class="token search-match">/g

/** Best-effort prismjs grammar for a remote file's extension. Falls back to
 * plain HTML-escaped text for anything unrecognized — this is a plain text
 * editor either way, syntax color is a nice-to-have, not a requirement.
 *
 * `searchQuery`, when non-empty, wins over the language's own tokenization
 * for any text it matches: Prism tries grammar entries in object-key order
 * and takes the first match at each position, so putting `search-match`
 * first means every occurrence gets wrapped in its own `token search-match`
 * span *before* the language grammar ever sees that text — `inside` then
 * re-runs the same language grammar just on the matched substring, so it
 * still gets its normal syntax color nested one level down instead of
 * losing it. The editor's CSS only paints a background on `search-match`
 * (no color), so the two layer cleanly: yellow highlight behind, syntax
 * color on top, for every match.
 *
 * `currentMatchIndex`, when given, additionally re-tags the Nth
 * `search-match` span (0-based, left-to-right — same order the find bar's
 * own `indexOf`-based scan finds them in, since both are a plain
 * case-insensitive literal search over the same text) with an extra
 * `search-match-current` class, so the find bar's "selected" occurrence
 * gets a visibly stronger highlight than the rest instead of relying on
 * the textarea's own (easy-to-miss, inconsistent across browsers)
 * unfocused-selection rendering. Post-processing the rendered HTML by
 * counting spans is simpler and more robust here than trying to express
 * "the Nth occurrence specifically" as a Prism grammar pattern — Prism
 * matches by regex, not by occurrence index, so there's no pattern that
 * means "only this one". */
export function highlightForPath(
  path: string,
  code: string,
  searchQuery?: string,
  currentMatchIndex?: number,
): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const grammarName = EXTENSION_TO_GRAMMAR[ext]
  const baseGrammar = grammarName ? languages[grammarName] : undefined

  if (searchQuery) {
    const combinedGrammar = {
      'search-match': {
        pattern: new RegExp(escapeRegExp(searchQuery), 'gi'),
        greedy: true,
        inside: baseGrammar ?? {},
      },
      ...(baseGrammar ?? {}),
    }
    const html = highlight(code, combinedGrammar, grammarName ?? 'none')
    if (currentMatchIndex === undefined) return html
    let occurrence = -1
    return html.replace(SEARCH_MATCH_SPAN_OPEN, (whole) => {
      occurrence += 1
      return occurrence === currentMatchIndex
        ? '<span class="token search-match search-match-current">'
        : whole
    })
  }

  if (!baseGrammar || !grammarName) return escapeHtml(code)
  return highlight(code, baseGrammar, grammarName)
}
