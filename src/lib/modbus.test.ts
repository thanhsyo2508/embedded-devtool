import { describe, expect, it } from 'vitest'
import {
  buildExceptionResponse,
  buildRequest,
  buildResponseFrame,
  parseRequestFrame,
  parseResponseFrame,
} from './modbus'

describe('buildRequest', () => {
  it('matches the standard read-holding-registers test vector', () => {
    expect(buildRequest(1, 0x03, 0, 10)).toEqual([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a, 0xc5, 0xcd])
  })
})

describe('read holding registers round trip', () => {
  it('build request -> parse request -> build response -> parse response', () => {
    const request = buildRequest(1, 0x03, 0, 2)
    const parsedRequest = parseRequestFrame(request)
    expect(parsedRequest.status).toBe('valid')
    if (parsedRequest.status !== 'valid') return
    expect(parsedRequest.frame).toEqual({
      slaveAddr: 1,
      functionCode: 0x03,
      startAddr: 0,
      quantity: 2,
      values: [],
    })

    const response = buildResponseFrame(1, 0x03, 0, 2, [0x1234, 0x5678])
    const parsedResponse = parseResponseFrame(0x03, response)
    expect(parsedResponse.status).toBe('valid')
    if (parsedResponse.status !== 'valid') return
    expect(parsedResponse.frame).toEqual({
      slaveAddr: 1,
      functionCode: 0x03,
      isException: false,
      values: [0x1234, 0x5678],
    })
  })
})

describe('write single register/coil', () => {
  it('response is a byte-for-byte echo of the request', () => {
    expect(buildResponseFrame(1, 0x06, 10, 1, [0x00ff])).toEqual(buildRequest(1, 0x06, 10, 0x00ff))
    // Coil "on" (1) encodes to the wire value 0xFF00, same as buildRequest(...,1).
    expect(buildResponseFrame(1, 0x05, 3, 1, [1])).toEqual(buildRequest(1, 0x05, 3, 1))
  })
})

describe('write multiple registers round trip', () => {
  it('build request -> parse request -> build echo response -> parse response', () => {
    const request = buildRequest(1, 0x10, 0, 3, [0x0001, 0x0002, 0x0003])
    const parsedRequest = parseRequestFrame(request)
    expect(parsedRequest.status).toBe('valid')
    if (parsedRequest.status !== 'valid') return
    expect(parsedRequest.frame.values).toEqual([0x0001, 0x0002, 0x0003])

    const response = buildResponseFrame(1, 0x10, 0, 3, [])
    const parsedResponse = parseResponseFrame(0x10, response)
    expect(parsedResponse.status).toBe('valid')
    if (parsedResponse.status !== 'valid') return
    expect(parsedResponse.frame.isException).toBe(false)
  })
})

describe('write multiple coils round trip', () => {
  it('packs and unpacks coil states without introducing padding artifacts', () => {
    const bits = [1, 0, 1, 1, 0, 0, 1, 0, 1]
    const request = buildRequest(1, 0x0f, 0, bits.length, bits)
    const parsed = parseRequestFrame(request)
    expect(parsed.status).toBe('valid')
    if (parsed.status !== 'valid') return
    expect(parsed.frame.values).toEqual(bits)
  })
})

describe('CRC validation', () => {
  it('rejects a frame with a flipped data bit (not a CRC bit) as invalid', () => {
    const request = buildRequest(1, 0x03, 0, 10)
    const corrupted = [...request]
    corrupted[2] ^= 0x01 // flip a bit in the start-address high byte
    expect(parseRequestFrame(corrupted)).toEqual({ status: 'invalid' })
  })
})

describe('exception response', () => {
  it('round trips through parseResponseFrame', () => {
    const response = buildExceptionResponse(1, 0x03, 0x02)
    const parsed = parseResponseFrame(0x03, response)
    expect(parsed.status).toBe('valid')
    if (parsed.status !== 'valid') return
    expect(parsed.frame).toEqual({
      slaveAddr: 1,
      functionCode: 0x03,
      isException: true,
      exceptionCode: 0x02,
    })
  })
})

describe('incomplete frames', () => {
  it('reports incomplete for a request truncated before its CRC', () => {
    const request = buildRequest(1, 0x03, 0, 10)
    expect(parseRequestFrame(request.slice(0, request.length - 1))).toEqual({
      status: 'incomplete',
    })
  })

  it('reports incomplete for a write-multiple request truncated before the byte-count field', () => {
    const request = buildRequest(1, 0x10, 0, 3, [1, 2, 3])
    expect(parseRequestFrame(request.slice(0, 5))).toEqual({ status: 'incomplete' })
  })

  it('reports incomplete for a response truncated before its byte-count field', () => {
    const response = buildResponseFrame(1, 0x03, 0, 2, [0x1234, 0x5678])
    expect(parseResponseFrame(0x03, response.slice(0, 2))).toEqual({ status: 'incomplete' })
  })
})
