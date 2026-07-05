/** Modbus TCP framing (Tháng 6 "protocol template"): the same PDUs as
 * Modbus RTU, carried behind an MBAP header instead of an address byte +
 * CRC16. This module is a thin adapter over `./modbus.ts` — RTU frames are
 * converted to/from TCP frames at the boundary so none of the PDU
 * build/parse logic is duplicated.
 *
 * MBAP layout (7 bytes, all big-endian):
 *   transactionId(u16) protocolId(u16, always 0) length(u16) unitId(u8)
 * where `length` counts unitId + PDU. The unit id plays the role of the
 * RTU slave address. */

import { crc16Modbus } from './crc'
import { parseResponseFrame, type ModbusFunctionCode, type ModbusResponseFrame } from './modbus'
import type { ParseResult } from './modbus'

function hi(n: number): number {
  return (n >> 8) & 0xff
}

function lo(n: number): number {
  return n & 0xff
}

/** Converts an RTU ADU (`[slaveAddr, ...PDU, crcLo, crcHi]`) into a Modbus
 * TCP frame — the RTU slave address becomes the MBAP unit id and the CRC
 * is dropped (TCP relies on the transport's own integrity). */
export function rtuToTcp(rtuFrame: number[], transactionId: number): number[] {
  const unitId = rtuFrame[0]
  const pdu = rtuFrame.slice(1, rtuFrame.length - 2)
  const length = pdu.length + 1
  return [hi(transactionId), lo(transactionId), 0, 0, hi(length), lo(length), unitId, ...pdu]
}

/** Re-wraps a TCP frame's unit id + PDU as an RTU ADU with a locally
 * computed CRC — which matches by construction, so the existing RTU
 * parsers accept it byte-for-byte unchanged. */
export function tcpToRtu(unitId: number, pdu: number[]): number[] {
  const body = [unitId, ...pdu]
  return [...body, ...crc16Modbus(body)]
}

export interface TcpFrame {
  transactionId: number
  unitId: number
  pdu: number[]
}

/** Incremental Modbus TCP frame parser (3-way result, same contract as the
 * RTU parsers, so it drops into `ModbusFrameAssembler` directly). MBAP's
 * explicit length field makes framing exact — no CRC hunting needed. */
export function parseTcpFrame(bytes: number[]): ParseResult<TcpFrame> {
  if (bytes.length < 7) return { status: 'incomplete' }
  const protocolId = (bytes[2] << 8) | bytes[3]
  if (protocolId !== 0) return { status: 'invalid' }
  const length = (bytes[4] << 8) | bytes[5]
  if (length < 2) return { status: 'invalid' } // must cover unitId + ≥1 PDU byte
  const totalLength = 6 + length
  if (bytes.length < totalLength) return { status: 'incomplete' }
  return {
    status: 'valid',
    consumedBytes: totalLength,
    frame: {
      transactionId: (bytes[0] << 8) | bytes[1],
      unitId: bytes[6],
      pdu: bytes.slice(7, totalLength),
    },
  }
}

/** Parses a Modbus TCP response for `functionCode` out of `bytes` by
 * unwrapping the MBAP header and delegating the PDU to the RTU response
 * parser. Transaction ids are not validated — the callers keep a single
 * request in flight and reset their assembler before each send, so a
 * mismatch cannot occur in practice. */
export function parseTcpResponseFrame(
  requestedFunctionCode: ModbusFunctionCode,
  bytes: number[],
): ParseResult<ModbusResponseFrame> {
  const tcp = parseTcpFrame(bytes)
  if (tcp.status !== 'valid') return tcp
  const rtu = parseResponseFrame(requestedFunctionCode, tcpToRtu(tcp.frame.unitId, tcp.frame.pdu))
  if (rtu.status !== 'valid') {
    // The TCP frame itself was complete and well-formed, so a PDU that
    // doesn't parse is invalid, never "wait for more bytes".
    return { status: 'invalid' }
  }
  return { status: 'valid', consumedBytes: tcp.consumedBytes, frame: rtu.frame }
}
