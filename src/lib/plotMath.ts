/** Math channels for the plotter (Tháng 7): derived series computed from
 * existing channels. Deliberately preset-operation-based rather than a free
 * expression parser — the roadmap's examples (ch1+ch2, moving average,
 * derivative, RMS) are all covered, and a parser would be speculative
 * complexity. Sources are restricted to real channels (no math-of-math). */

export type MathOp = 'add' | 'sub' | 'mul' | 'div' | 'movingAvg' | 'derivative' | 'rms'

export interface MathChannelDef {
  id: string
  enabled: boolean
  label: string
  op: MathOp
  sourceA: string
  /** Second operand — only used by the binary ops (add/sub/mul/div). */
  sourceB?: string
  /** Trailing sample window — only used by movingAvg/rms. */
  window?: number
}

export const MATH_OPS: { value: MathOp; label: string; binary: boolean; windowed: boolean }[] = [
  { value: 'add', label: 'A + B', binary: true, windowed: false },
  { value: 'sub', label: 'A − B', binary: true, windowed: false },
  { value: 'mul', label: 'A × B', binary: true, windowed: false },
  { value: 'div', label: 'A ÷ B', binary: true, windowed: false },
  { value: 'movingAvg', label: 'Moving avg (A)', binary: false, windowed: true },
  { value: 'derivative', label: 'Derivative dA/dt', binary: false, windowed: false },
  { value: 'rms', label: 'RMS (A)', binary: false, windowed: true },
]

const DEFAULT_WINDOW = 10

function binaryOp(
  a: (number | null)[],
  b: (number | null)[],
  f: (x: number, y: number) => number | null,
): (number | null)[] {
  return a.map((x, i) => {
    const y = b[i] ?? null
    if (x === null || y === null) return null
    return f(x, y)
  })
}

/** Trailing-window aggregate: out[i] covers samples (i-window, i]. Fewer
 * samples than the window at the start just aggregates what exists. */
function windowedOp(
  values: (number | null)[],
  window: number,
  f: (samples: number[]) => number,
): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < values.length; i++) {
    const samples: number[] = []
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      const v = values[j]
      if (v !== null) samples.push(v)
    }
    out.push(samples.length > 0 ? f(samples) : null)
  }
  return out
}

/** Computes one math channel's value array, index-aligned with
 * `timestampsMs`. Guards that matter for real data: derivative with dt <= 0
 * yields null (batched lines often share the same millisecond timestamp —
 * an Infinity would break uPlot's autoscale), and division by zero yields
 * null rather than ±Infinity. */
export function computeMathChannel(
  def: MathChannelDef,
  channelData: Record<string, (number | null)[]>,
  timestampsMs: number[],
): (number | null)[] {
  const a = channelData[def.sourceA]
  if (!a) return timestampsMs.map(() => null)

  switch (def.op) {
    case 'add':
    case 'sub':
    case 'mul':
    case 'div': {
      const b = def.sourceB ? channelData[def.sourceB] : undefined
      if (!b) return timestampsMs.map(() => null)
      switch (def.op) {
        case 'add':
          return binaryOp(a, b, (x, y) => x + y)
        case 'sub':
          return binaryOp(a, b, (x, y) => x - y)
        case 'mul':
          return binaryOp(a, b, (x, y) => x * y)
        case 'div':
          return binaryOp(a, b, (x, y) => (y === 0 ? null : x / y))
      }
      break
    }
    case 'movingAvg':
      return windowedOp(a, def.window ?? DEFAULT_WINDOW, (s) => {
        let sum = 0
        for (const v of s) sum += v
        return sum / s.length
      })
    case 'rms':
      return windowedOp(a, def.window ?? DEFAULT_WINDOW, (s) => {
        let sumSq = 0
        for (const v of s) sumSq += v * v
        return Math.sqrt(sumSq / s.length)
      })
    case 'derivative': {
      const out: (number | null)[] = [null]
      for (let i = 1; i < a.length; i++) {
        const prev = a[i - 1]
        const cur = a[i]
        const dtSec = (timestampsMs[i] - timestampsMs[i - 1]) / 1000
        if (prev === null || cur === null || dtSec <= 0) {
          out.push(null)
        } else {
          out.push((cur - prev) / dtSec)
        }
      }
      return out
    }
  }
}
