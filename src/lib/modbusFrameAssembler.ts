/** Incremental byte-buffer -> Modbus frame parser, shared by the Master's
 * response capture and the Slave's request capture (`./modbus.ts` has no
 * concept of "bytes arrive in chunks over time" — this bridges that gap).
 *
 * There is no way to observe true Modbus RTU inter-frame silence (T3.5)
 * from JS/Tauri-event granularity, so frame boundaries are found purely via
 * CRC + expected-length heuristics: try to parse from the front of the
 * buffer on every push, resync by dropping one byte at a time on a CRC/
 * structural failure, and cap the buffer at the Modbus RTU spec's maximum
 * ADU size so unrecoverable noise can't grow it unbounded. This is a
 * documented, accepted limitation for a testing tool — not a certified
 * Modbus stack — matching the plan's own acknowledgment that this is the
 * trickiest part of the whole feature. */

import type { ParseResult } from './modbus'

/** Modbus RTU's spec-mandated maximum ADU (address + PDU + CRC) size. */
export const MAX_ADU_SIZE = 256

export class ModbusFrameAssembler<T> {
  private buffer: number[] = []

  constructor(private readonly tryParse: (bytes: number[]) => ParseResult<T>) {}

  /** Appends newly-received bytes and returns every frame parsed out of the
   * buffer so far, in order. Safe to call repeatedly as batches arrive —
   * state (including any partial frame) persists across calls. */
  push(bytes: number[]): T[] {
    this.buffer.push(...bytes)
    const frames: T[] = []
    while (this.buffer.length > 0) {
      const result = this.tryParse(this.buffer)
      if (result.status === 'incomplete') {
        if (this.buffer.length > MAX_ADU_SIZE) this.buffer = []
        break
      }
      if (result.status === 'invalid') {
        this.buffer.shift() // resync: drop one byte and retry from the new offset
        continue
      }
      frames.push(result.frame)
      this.buffer.splice(0, result.consumedBytes)
    }
    return frames
  }

  /** Discards any buffered (partial) bytes — used before starting a fresh
   * request so stale bytes from an earlier exchange can't corrupt the next
   * parse. */
  reset(): void {
    this.buffer = []
  }
}
