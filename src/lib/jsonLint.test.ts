import { describe, expect, it } from 'vitest'
import { findDuplicateKeys, flattenKeys } from './jsonLint'

describe('findDuplicateKeys', () => {
  it('returns nothing for a clean document', () => {
    expect(findDuplicateKeys('{"a": 1, "b": {"c": 2, "d": 3}}')).toEqual([])
  })

  it('flags a duplicate sibling key', () => {
    expect(findDuplicateKeys('{"a": 1, "a": 2}')).toEqual(['a'])
  })

  it('reports the nested path of the duplicate', () => {
    const text = '{"help": {"section": {"x": 1}, "section": {"y": 2}}}'
    expect(findDuplicateKeys(text)).toEqual(['help.section'])
  })

  it('allows the same key name in different objects', () => {
    const text = '{"a": {"heading": 1}, "b": {"heading": 2}}'
    expect(findDuplicateKeys(text)).toEqual([])
  })

  it('is not confused by a value string equal to a key name', () => {
    // "a" appears as a value here, not a second key — must not flag.
    expect(findDuplicateKeys('{"a": "a", "b": "a"}')).toEqual([])
  })

  it('handles arrays of objects without false positives', () => {
    const text = '{"items": [{"id": 1}, {"id": 2}, {"id": 3}]}'
    expect(findDuplicateKeys(text)).toEqual([])
  })

  it('ignores braces and colons inside string values', () => {
    const text = '{"a": "{ not: a, key }", "b": 2}'
    expect(findDuplicateKeys(text)).toEqual([])
  })

  it('handles escaped quotes inside strings', () => {
    const text = '{"a": "he said \\"hi\\"", "a": 2}'
    expect(findDuplicateKeys(text)).toEqual(['a'])
  })

  it('catches a duplicate nested inside an array element', () => {
    expect(findDuplicateKeys('{"list": [{"k": 1, "k": 2}]}')).toEqual(['list[].k'])
  })
})

describe('flattenKeys', () => {
  it('flattens nested objects to dotted leaf paths', () => {
    expect(flattenKeys({ a: 1, b: { c: 2, d: { e: 3 } } })).toEqual(['a', 'b.c', 'b.d.e'])
  })

  it('treats an array as a single leaf (not indexed)', () => {
    expect(flattenKeys({ a: [1, 2, 3] })).toEqual(['a'])
  })
})
