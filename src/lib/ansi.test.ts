import { describe, expect, it } from 'vitest'
import { parseAnsi } from './ansi'

describe('parseAnsi', () => {
  it('returns a single plain segment when there are no escapes', () => {
    const segs = parseAnsi('hello world')
    expect(segs).toEqual([{ text: 'hello world', style: {} }])
  })

  it('colors text between an SGR code and its reset', () => {
    const segs = parseAnsi('\x1b[31mERROR\x1b[0m done')
    expect(segs[0]).toEqual({ text: 'ERROR', style: { fg: '#c0392b' } })
    expect(segs[1].text).toBe(' done')
    expect(segs[1].style.fg).toBeUndefined()
  })

  it('handles the ESP-IDF style prefix (bold + color in one code)', () => {
    const segs = parseAnsi('\x1b[0;31mE (123) wifi\x1b[0m')
    expect(segs[0].style.fg).toBe('#c0392b')
    expect(segs[0].text).toBe('E (123) wifi')
  })

  it('strips non-color escape sequences', () => {
    const segs = parseAnsi('a\x1b[2Kb')
    expect(segs.map((s) => s.text).join('')).toBe('ab')
  })

  it('tracks bold and underline', () => {
    const segs = parseAnsi('\x1b[1;4mx\x1b[0m')
    expect(segs[0].style.bold).toBe(true)
    expect(segs[0].style.underline).toBe(true)
  })

  it('drops empty runs', () => {
    const segs = parseAnsi('\x1b[31m\x1b[0mhi')
    expect(segs).toEqual([{ text: 'hi', style: {} }])
  })
})
