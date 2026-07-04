import { describe, expect, it } from 'vitest'
import { ModbusFrameAssembler, MAX_ADU_SIZE } from './modbusFrameAssembler'
import { buildRequest, parseRequestFrame, type ModbusRequestFrame } from './modbus'

function newAssembler() {
  return new ModbusFrameAssembler<ModbusRequestFrame>(parseRequestFrame)
}

describe('ModbusFrameAssembler', () => {
  it('yields one frame when pushed all at once', () => {
    const assembler = newAssembler()
    const frame = buildRequest(1, 0x03, 0, 10)
    const frames = assembler.push(frame)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ slaveAddr: 1, functionCode: 0x03 })
  })

  it('yields one frame when split across multiple push() calls', () => {
    const assembler = newAssembler()
    const frame = buildRequest(1, 0x03, 0, 10)
    const first = assembler.push(frame.slice(0, 3))
    expect(first).toHaveLength(0)
    const second = assembler.push(frame.slice(3))
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ slaveAddr: 1, functionCode: 0x03, quantity: 10 })
  })

  it('yields two frames in order when both arrive in one push', () => {
    const assembler = newAssembler()
    const frameA = buildRequest(1, 0x03, 0, 10)
    const frameB = buildRequest(2, 0x06, 5, 42)
    const frames = assembler.push([...frameA, ...frameB])
    expect(frames).toHaveLength(2)
    expect(frames[0]).toMatchObject({ slaveAddr: 1, functionCode: 0x03 })
    expect(frames[1]).toMatchObject({ slaveAddr: 2, functionCode: 0x06 })
  })

  it('recovers from garbage bytes preceding a valid frame', () => {
    const assembler = newAssembler()
    const frame = buildRequest(1, 0x03, 0, 10)
    const frames = assembler.push([0xaa, 0xbb, ...frame])
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ slaveAddr: 1, functionCode: 0x03 })
  })

  it('resets after more than the max ADU size of unrecoverable garbage', () => {
    const assembler = newAssembler()
    // A run of zero bytes never forms a valid frame (function code 0x00
    // isn't recognized) and never becomes "incomplete" either — it's
    // rejected outright, so this specifically exercises the shift-and-retry
    // path shrinking the buffer back to empty on its own.
    const frames = assembler.push(new Array(MAX_ADU_SIZE + 50).fill(0x00))
    expect(frames).toHaveLength(0)

    // The assembler should still correctly find a real frame pushed next,
    // proving it didn't get stuck holding onto stale garbage.
    const frame = buildRequest(1, 0x03, 0, 10)
    expect(assembler.push(frame)).toHaveLength(1)
  })

  it('reset() discards buffered partial bytes', () => {
    const assembler = newAssembler()
    const frame = buildRequest(1, 0x03, 0, 10)
    assembler.push(frame.slice(0, 3))
    assembler.reset()
    // Without reset, appending the rest of `frame` here would complete it;
    // with reset, those 3 bytes are gone and this fresh frame parses cleanly.
    const frames = assembler.push(buildRequest(2, 0x06, 1, 99))
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ slaveAddr: 2, functionCode: 0x06 })
  })
})
