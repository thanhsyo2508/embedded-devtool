import { describe, expect, it } from 'vitest'
import { decodeStruct } from './structDecode'

describe('decodeStruct', () => {
  it('decodes named fields sequentially in little-endian', () => {
    // id=0x0102, temp=1.0f, flags=0xAB
    const bytes = [0x02, 0x01, 0x00, 0x00, 0x80, 0x3f, 0xab]
    const r = decodeStruct(bytes, 'uint16 id\nfloat32 temp\nuint8 flags', 'le')
    expect(r.templateError).toBeNull()
    expect(r.truncated).toBe(false)
    expect(r.fields).toEqual([
      { name: 'id', type: 'uint16', value: '258' },
      { name: 'temp', type: 'float32', value: '1' },
      { name: 'flags', type: 'uint8', value: '171' },
    ])
  })

  it('respects big-endian', () => {
    const r = decodeStruct([0x01, 0x02], 'uint16 id', 'be')
    expect(r.fields[0].value).toBe('258')
  })

  it('skips comments and blank lines', () => {
    const r = decodeStruct([0x05], '// header\n\nuint8 n // count', 'le')
    expect(r.fields).toEqual([{ name: 'n', type: 'uint8', value: '5' }])
  })

  it('decodes char[N] as text and bytes[N] as hex', () => {
    const r = decodeStruct([0x41, 0x42, 0xff, 0x00], 'char[2] tag\nbytes[2] raw', 'le')
    expect(r.fields[0].value).toBe('AB')
    expect(r.fields[1].value).toBe('ff 00')
  })

  it('skips pad[N] bytes', () => {
    const r = decodeStruct([0xaa, 0xbb, 0x07], 'pad[2]\nuint8 v', 'le')
    expect(r.fields).toEqual([{ name: 'v', type: 'uint8', value: '7' }])
  })

  it('reports an unknown type as a template error', () => {
    const r = decodeStruct([0x01], 'uint7 x', 'le')
    expect(r.templateError).toMatch(/line 1/)
    expect(r.templateError).toMatch(/uint7/)
  })

  it('marks truncation when bytes run out, keeping what fit', () => {
    const r = decodeStruct([0x01], 'uint8 a\nuint32 b', 'le')
    expect(r.truncated).toBe(true)
    expect(r.fields).toEqual([{ name: 'a', type: 'uint8', value: '1' }])
  })
})
