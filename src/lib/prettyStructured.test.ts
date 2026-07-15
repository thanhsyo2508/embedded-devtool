import { describe, expect, it } from 'vitest'
import { prettyStructured } from './prettyStructured'

describe('prettyStructured', () => {
  it('pretty-prints JSON', () => {
    const r = prettyStructured('{"a":1,"b":[2,3]}')
    expect(r.kind).toBe('json')
    expect(r.formatted).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}')
  })

  it('aligns CSV columns', () => {
    const r = prettyStructured('name,age\nalice,30\nbob,7')
    expect(r.kind).toBe('csv')
    expect(r.formatted).toBe('name   age\nalice  30\nbob    7')
  })

  it('leaves plain text untouched', () => {
    const r = prettyStructured('just a log line')
    expect(r.kind).toBe('raw')
    expect(r.formatted).toBe('just a log line')
  })

  it('does not treat a single comma-containing line as CSV', () => {
    expect(prettyStructured('hello, world').kind).toBe('raw')
  })

  it('falls back to raw for malformed JSON', () => {
    expect(prettyStructured('{not json}').kind).toBe('raw')
  })
})
