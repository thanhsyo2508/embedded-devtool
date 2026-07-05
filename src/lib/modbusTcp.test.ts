import { describe, expect, it } from 'vitest'
import { buildRequest, buildResponseFrame, parseRequestFrame } from './modbus'
import { parseTcpFrame, parseTcpResponseFrame, rtuToTcp, tcpToRtu } from './modbusTcp'

describe('rtuToTcp / parseTcpFrame / tcpToRtu', () => {
  it('round trips an RTU request through TCP framing unchanged', () => {
    const rtu = buildRequest(1, 0x03, 0, 10)
    const tcp = rtuToTcp(rtu, 0x1234)
    // MBAP: tid 0x1234, protocol 0, length = PDU(5) + unitId(1) = 6, unit 1.
    expect(tcp.slice(0, 7)).toEqual([0x12, 0x34, 0x00, 0x00, 0x00, 0x06, 0x01])

    const parsed = parseTcpFrame(tcp)
    expect(parsed.status).toBe('valid')
    if (parsed.status !== 'valid') return
    expect(parsed.frame.transactionId).toBe(0x1234)
    expect(parsed.frame.unitId).toBe(1)
    expect(parsed.consumedBytes).toBe(tcp.length)

    // Re-wrapped as RTU it must equal the original frame byte-for-byte —
    // proving the locally recomputed CRC matches and the existing RTU
    // parsers will accept it unchanged.
    expect(tcpToRtu(parsed.frame.unitId, parsed.frame.pdu)).toEqual(rtu)
    const rtuParsed = parseRequestFrame(tcpToRtu(parsed.frame.unitId, parsed.frame.pdu))
    expect(rtuParsed.status).toBe('valid')
  })

  it('reports incomplete for a truncated MBAP header and a truncated body', () => {
    const tcp = rtuToTcp(buildRequest(1, 0x03, 0, 10), 1)
    expect(parseTcpFrame(tcp.slice(0, 5))).toEqual({ status: 'incomplete' })
    expect(parseTcpFrame(tcp.slice(0, tcp.length - 1))).toEqual({ status: 'incomplete' })
  })

  it('rejects a nonzero protocol id as invalid', () => {
    const tcp = rtuToTcp(buildRequest(1, 0x03, 0, 10), 1)
    tcp[2] = 0x01
    expect(parseTcpFrame(tcp)).toEqual({ status: 'invalid' })
  })

  it('parses two concatenated frames in order', () => {
    const a = rtuToTcp(buildRequest(1, 0x03, 0, 1), 1)
    const b = rtuToTcp(buildRequest(2, 0x06, 5, 42), 2)
    const first = parseTcpFrame([...a, ...b])
    expect(first.status).toBe('valid')
    if (first.status !== 'valid') return
    expect(first.frame.unitId).toBe(1)
    const second = parseTcpFrame([...a, ...b].slice(first.consumedBytes))
    expect(second.status).toBe('valid')
    if (second.status !== 'valid') return
    expect(second.frame.unitId).toBe(2)
  })
})

describe('parseTcpResponseFrame', () => {
  it('round trips a read-holding-registers response', () => {
    const rtuResponse = buildResponseFrame(1, 0x03, 0, 2, [0x1234, 0x5678])
    const tcpResponse = rtuToTcp(rtuResponse, 7)
    const parsed = parseTcpResponseFrame(0x03, tcpResponse)
    expect(parsed.status).toBe('valid')
    if (parsed.status !== 'valid') return
    expect(parsed.consumedBytes).toBe(tcpResponse.length)
    expect(parsed.frame).toEqual({
      slaveAddr: 1,
      functionCode: 0x03,
      isException: false,
      values: [0x1234, 0x5678],
    })
  })

  it('a complete TCP frame with a garbage PDU is invalid, not incomplete', () => {
    // Valid MBAP declaring a 2-byte body, but the PDU function code doesn't
    // match what was requested.
    const frame = [0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x01, 0x7f]
    expect(parseTcpResponseFrame(0x03, frame)).toEqual({ status: 'invalid' })
  })
})
