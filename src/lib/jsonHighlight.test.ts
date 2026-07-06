import { describe, expect, it } from 'vitest'
import { tokenizeJson } from './jsonHighlight'

describe('tokenizeJson', () => {
  it('classifies keys, strings, numbers, booleans, and null', () => {
    const text = '{\n  "a": "x",\n  "b": 1.5,\n  "c": true,\n  "d": null\n}'
    const tokens = tokenizeJson(text)
    const byKind = (kind: string) => tokens.filter((t) => t.kind === kind).map((t) => t.text)
    expect(byKind('key')).toEqual(['"a":', '"b":', '"c":', '"d":'])
    expect(byKind('string')).toEqual(['"x"'])
    expect(byKind('number')).toEqual(['1.5'])
    expect(byKind('boolean')).toEqual(['true'])
    expect(byKind('null')).toEqual(['null'])
  })

  it('preserves punctuation and whitespace as untagged tokens', () => {
    const tokens = tokenizeJson('{"a":1}')
    const rebuilt = tokens.map((t) => t.text).join('')
    expect(rebuilt).toBe('{"a":1}')
    expect(tokens.some((t) => t.kind === null && t.text === '{')).toBe(true)
  })

  it('handles escaped quotes inside strings', () => {
    const tokens = tokenizeJson('{"a": "say \\"hi\\""}')
    const strings = tokens.filter((t) => t.kind === 'string').map((t) => t.text)
    expect(strings).toEqual(['"say \\"hi\\""'])
  })

  it('handles negative and exponent numbers', () => {
    const tokens = tokenizeJson('[-3, 2e10, 1.2e-3]')
    const numbers = tokens.filter((t) => t.kind === 'number').map((t) => t.text)
    expect(numbers).toEqual(['-3', '2e10', '1.2e-3'])
  })

  it('round-trips arbitrary text back to the original string', () => {
    const text = '{"nested": {"list": [1, 2, "three"], "flag": false}}'
    const tokens = tokenizeJson(text)
    expect(tokens.map((t) => t.text).join('')).toBe(text)
  })
})
