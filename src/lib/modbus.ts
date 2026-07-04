/** Modbus RTU PDU/ADU codec — pure functions, no I/O. Covers the 8 standard
 * data-access function codes. Frame layout follows the Modbus Application
 * Protocol spec; CRC is `crc16Modbus` from `./crc.ts`.
 *
 * Parsers return a 3-way tagged result rather than null-or-parsed, because
 * write-multiple frames (0x0F/0x10) carry a byte-count field partway
 * through the frame, so a partial buffer can't always be classified as
 * simply valid/invalid — it may just need more bytes ("incomplete"). This
 * is required by the incremental frame assembler (`./modbusFrameAssembler.ts`)
 * that consumes these parsers byte batch by byte batch. */

import { crc16Modbus } from './crc'

export type ModbusFunctionCode = 0x01 | 0x02 | 0x03 | 0x04 | 0x05 | 0x06 | 0x0f | 0x10

export const FUNCTION_CODES: { value: ModbusFunctionCode; label: string }[] = [
  { value: 0x01, label: '01 Read Coils' },
  { value: 0x02, label: '02 Read Discrete Inputs' },
  { value: 0x03, label: '03 Read Holding Registers' },
  { value: 0x04, label: '04 Read Input Registers' },
  { value: 0x05, label: '05 Write Single Coil' },
  { value: 0x06, label: '06 Write Single Register' },
  { value: 0x0f, label: '0F Write Multiple Coils' },
  { value: 0x10, label: '10 Write Multiple Registers' },
]

/** Function codes valid for a repeating poll rule — writes don't make
 * sense to poll. */
export const READ_FUNCTION_CODES: ModbusFunctionCode[] = [0x01, 0x02, 0x03, 0x04]

export interface ModbusRequestFrame {
  slaveAddr: number
  functionCode: ModbusFunctionCode
  startAddr: number
  quantity: number
  /** Coil states (0/1) for 0x05/0x0F, register values for 0x06/0x10; empty
   * for read requests (0x01-0x04), which carry no data. */
  values: number[]
}

export type ModbusResponseFrame =
  | { slaveAddr: number; functionCode: ModbusFunctionCode; isException: false; values: number[] }
  | {
      slaveAddr: number
      functionCode: ModbusFunctionCode
      isException: true
      exceptionCode: number
    }

export type ParseResult<T> =
  | { status: 'incomplete' }
  | { status: 'invalid' }
  | { status: 'valid'; frame: T; consumedBytes: number }

function hi(n: number): number {
  return (n >> 8) & 0xff
}

function lo(n: number): number {
  return n & 0xff
}

function withCrc(bytes: number[]): number[] {
  return [...bytes, ...crc16Modbus(bytes)]
}

function isModbusFunctionCode(code: number): code is ModbusFunctionCode {
  return (
    code === 0x01 ||
    code === 0x02 ||
    code === 0x03 ||
    code === 0x04 ||
    code === 0x05 ||
    code === 0x06 ||
    code === 0x0f ||
    code === 0x10
  )
}

/** Packs 0/1 values into bytes, bit 0 of the first byte = first value (per
 * the Modbus coil-packing convention). */
function packCoils(bits: number[]): number[] {
  const byteCount = Math.ceil(bits.length / 8)
  const bytes = new Array(byteCount).fill(0)
  bits.forEach((bit, i) => {
    if (bit) bytes[Math.floor(i / 8)] |= 1 << (i % 8)
  })
  return bytes
}

function unpackCoils(bytes: number[], count: number): number[] {
  const bits: number[] = []
  for (let i = 0; i < count; i++) {
    const byte = bytes[Math.floor(i / 8)] ?? 0
    bits.push((byte >> (i % 8)) & 1)
  }
  return bits
}

/** Builds a full request ADU (address + PDU + CRC). `quantityOrValue` is
 * the register/coil count for 0x01-0x04/0x0F/0x10, the coil on/off flag for
 * 0x05, or the register value for 0x06. `values` supplies the data payload
 * for 0x0F (coil states, 0/1) and 0x10 (register values). */
export function buildRequest(
  slaveAddr: number,
  functionCode: ModbusFunctionCode,
  startAddr: number,
  quantityOrValue: number,
  values?: number[],
): number[] {
  const header = [slaveAddr, functionCode, hi(startAddr), lo(startAddr)]
  switch (functionCode) {
    case 0x01:
    case 0x02:
    case 0x03:
    case 0x04:
    case 0x06:
      return withCrc([...header, hi(quantityOrValue), lo(quantityOrValue)])
    case 0x05: {
      const coilValue = quantityOrValue ? 0xff00 : 0x0000
      return withCrc([...header, hi(coilValue), lo(coilValue)])
    }
    case 0x0f: {
      const coilBytes = packCoils(values ?? [])
      return withCrc([
        ...header,
        hi(quantityOrValue),
        lo(quantityOrValue),
        coilBytes.length,
        ...coilBytes,
      ])
    }
    case 0x10: {
      const regBytes: number[] = []
      for (const v of values ?? []) regBytes.push(hi(v), lo(v))
      return withCrc([
        ...header,
        hi(quantityOrValue),
        lo(quantityOrValue),
        regBytes.length,
        ...regBytes,
      ])
    }
  }
}

/** Parses a master request out of `bytes` (used by the Slave emulator).
 * Consumes exactly the matched frame's length — callers should slice
 * `consumedBytes` off the front of their buffer, not clear it entirely,
 * since another frame may legitimately follow. */
export function parseRequestFrame(bytes: number[]): ParseResult<ModbusRequestFrame> {
  if (bytes.length < 2) return { status: 'incomplete' }
  const functionCode = bytes[1]
  if (!isModbusFunctionCode(functionCode)) return { status: 'invalid' }

  let expectedLength: number
  if (functionCode === 0x0f || functionCode === 0x10) {
    if (bytes.length < 7) return { status: 'incomplete' }
    expectedLength = 7 + bytes[6] + 2
  } else {
    expectedLength = 8
  }
  if (bytes.length < expectedLength) return { status: 'incomplete' }

  const frame = bytes.slice(0, expectedLength)
  const data = frame.slice(0, expectedLength - 2)
  const crc = frame.slice(expectedLength - 2)
  const expectedCrc = crc16Modbus(data)
  if (crc[0] !== expectedCrc[0] || crc[1] !== expectedCrc[1]) return { status: 'invalid' }

  const slaveAddr = frame[0]
  const startAddr = (frame[2] << 8) | frame[3]
  const consumedBytes = expectedLength

  switch (functionCode) {
    case 0x01:
    case 0x02:
    case 0x03:
    case 0x04: {
      const quantity = (frame[4] << 8) | frame[5]
      return {
        status: 'valid',
        consumedBytes,
        frame: { slaveAddr, functionCode, startAddr, quantity, values: [] },
      }
    }
    case 0x05: {
      const raw = (frame[4] << 8) | frame[5]
      return {
        status: 'valid',
        consumedBytes,
        frame: {
          slaveAddr,
          functionCode,
          startAddr,
          quantity: 1,
          values: [raw === 0xff00 ? 1 : 0],
        },
      }
    }
    case 0x06: {
      const value = (frame[4] << 8) | frame[5]
      return {
        status: 'valid',
        consumedBytes,
        frame: { slaveAddr, functionCode, startAddr, quantity: 1, values: [value] },
      }
    }
    case 0x0f: {
      const quantity = (frame[4] << 8) | frame[5]
      const byteCount = frame[6]
      const coilBytes = frame.slice(7, 7 + byteCount)
      return {
        status: 'valid',
        consumedBytes,
        frame: {
          slaveAddr,
          functionCode,
          startAddr,
          quantity,
          values: unpackCoils(coilBytes, quantity),
        },
      }
    }
    case 0x10: {
      const quantity = (frame[4] << 8) | frame[5]
      const byteCount = frame[6]
      const regBytes = frame.slice(7, 7 + byteCount)
      const values: number[] = []
      for (let i = 0; i < quantity; i++) values.push((regBytes[i * 2] << 8) | regBytes[i * 2 + 1])
      return {
        status: 'valid',
        consumedBytes,
        frame: { slaveAddr, functionCode, startAddr, quantity, values },
      }
    }
  }
}

/** Parses a slave's response out of `bytes` (used by the Master). The
 * caller must supply the function code it requested, since a response PDU
 * doesn't repeat it in a form distinguishable from an exception on its own.
 *
 * For 0x01/0x02 (read coils/discrete inputs), `values` contains every bit
 * in the returned byte-packed payload (`byteCount * 8` entries) — the
 * response PDU has no room for the original requested quantity, so a caller
 * that requested e.g. 10 coils should only look at the first 10 of
 * `values`, ignoring the padding bits the slave used to fill the last byte. */
export function parseResponseFrame(
  requestedFunctionCode: ModbusFunctionCode,
  bytes: number[],
): ParseResult<ModbusResponseFrame> {
  if (bytes.length < 2) return { status: 'incomplete' }
  const slaveAddr = bytes[0]
  const responseFunctionCode = bytes[1]
  const isException = responseFunctionCode === (requestedFunctionCode | 0x80)
  if (!isException && responseFunctionCode !== requestedFunctionCode) {
    return { status: 'invalid' }
  }

  let expectedLength: number
  if (isException) {
    expectedLength = 5
  } else if (
    requestedFunctionCode === 0x01 ||
    requestedFunctionCode === 0x02 ||
    requestedFunctionCode === 0x03 ||
    requestedFunctionCode === 0x04
  ) {
    if (bytes.length < 3) return { status: 'incomplete' }
    expectedLength = 3 + bytes[2] + 2
  } else {
    expectedLength = 8 // 0x05/0x06/0x0F/0x10 responses are a fixed-length echo
  }
  if (bytes.length < expectedLength) return { status: 'incomplete' }

  const frame = bytes.slice(0, expectedLength)
  const data = frame.slice(0, expectedLength - 2)
  const crc = frame.slice(expectedLength - 2)
  const expectedCrc = crc16Modbus(data)
  if (crc[0] !== expectedCrc[0] || crc[1] !== expectedCrc[1]) return { status: 'invalid' }

  const consumedBytes = expectedLength

  if (isException) {
    return {
      status: 'valid',
      consumedBytes,
      frame: {
        slaveAddr,
        functionCode: requestedFunctionCode,
        isException: true,
        exceptionCode: frame[2],
      },
    }
  }

  let values: number[]
  switch (requestedFunctionCode) {
    case 0x01:
    case 0x02: {
      const byteCount = frame[2]
      values = unpackCoils(frame.slice(3, 3 + byteCount), byteCount * 8)
      break
    }
    case 0x03:
    case 0x04: {
      const byteCount = frame[2]
      const regBytes = frame.slice(3, 3 + byteCount)
      values = []
      for (let i = 0; i < byteCount / 2; i++) {
        values.push((regBytes[i * 2] << 8) | regBytes[i * 2 + 1])
      }
      break
    }
    case 0x05: {
      const raw = (frame[4] << 8) | frame[5]
      values = [raw === 0xff00 ? 1 : 0]
      break
    }
    case 0x06:
      values = [(frame[4] << 8) | frame[5]]
      break
    case 0x0f:
    case 0x10:
      // Echo of start address + quantity only, no data to unpack.
      values = [(frame[4] << 8) | frame[5]]
      break
  }

  return {
    status: 'valid',
    consumedBytes,
    frame: { slaveAddr, functionCode: requestedFunctionCode, isException: false, values },
  }
}

/** Builds a slave's response ADU from its own register/coil values (already
 * looked up by the caller for the requested range — this function has no
 * knowledge of how the Slave emulator's register map is stored). */
export function buildResponseFrame(
  slaveAddr: number,
  functionCode: ModbusFunctionCode,
  startAddr: number,
  quantity: number,
  values: number[],
): number[] {
  switch (functionCode) {
    case 0x01:
    case 0x02: {
      const coilBytes = packCoils(values)
      return withCrc([slaveAddr, functionCode, coilBytes.length, ...coilBytes])
    }
    case 0x03:
    case 0x04: {
      const regBytes: number[] = []
      for (const v of values) regBytes.push(hi(v), lo(v))
      return withCrc([slaveAddr, functionCode, regBytes.length, ...regBytes])
    }
    case 0x05:
    case 0x06:
      // Per spec, write-single responses are byte-for-byte echoes of the request.
      return buildRequest(slaveAddr, functionCode, startAddr, values[0] ?? 0)
    case 0x0f:
    case 0x10:
      return withCrc([
        slaveAddr,
        functionCode,
        hi(startAddr),
        lo(startAddr),
        hi(quantity),
        lo(quantity),
      ])
  }
}

/** Builds a Modbus exception response (e.g. 0x02 illegal data address). */
export function buildExceptionResponse(
  slaveAddr: number,
  functionCode: ModbusFunctionCode,
  exceptionCode: number,
): number[] {
  return withCrc([slaveAddr, functionCode | 0x80, exceptionCode])
}
