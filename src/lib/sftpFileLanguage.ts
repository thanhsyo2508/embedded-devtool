import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-lua'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-ini'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-c'

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
}

function escapeHtml(code: string): string {
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Best-effort prismjs grammar for a remote file's extension. Falls back to
 * plain HTML-escaped text for anything unrecognized — this is a plain text
 * editor either way, syntax color is a nice-to-have, not a requirement. */
export function highlightForPath(path: string, code: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const grammarName = EXTENSION_TO_GRAMMAR[ext]
  const grammar = grammarName ? languages[grammarName] : undefined
  if (!grammar || !grammarName) return escapeHtml(code)
  return highlight(code, grammar, grammarName)
}
