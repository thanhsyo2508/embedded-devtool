/** Line-level diff of two logs (LCS-based) for the "compare a working run
 * vs a broken one" workflow — returns rows already aligned into left/right
 * columns so the UI just renders them. */

export type DiffKind = 'same' | 'added' | 'removed'

export interface DiffRow {
  kind: DiffKind
  left: string | null
  right: string | null
}

/** Longest-common-subsequence diff. The DP matrix is O(n·m), so callers
 * should cap very long inputs before calling (the compare UI does). */
export function diffLines(a: string[], b: string[]): DiffRow[] {
  const n = a.length
  const m = b.length

  // dp[i][j] = LCS length of a[i:] and b[j:]. Int32Array rows keep the
  // matrix compact for the few-thousand-line inputs this is used on.
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: 'same', left: a[i], right: b[j] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: 'removed', left: a[i], right: null })
      i++
    } else {
      rows.push({ kind: 'added', left: null, right: b[j] })
      j++
    }
  }
  while (i < n) {
    rows.push({ kind: 'removed', left: a[i], right: null })
    i++
  }
  while (j < m) {
    rows.push({ kind: 'added', left: null, right: b[j] })
    j++
  }
  return rows
}

export interface DiffStats {
  added: number
  removed: number
  same: number
}

export function diffStats(rows: DiffRow[]): DiffStats {
  const stats: DiffStats = { added: 0, removed: 0, same: 0 }
  for (const row of rows) stats[row.kind]++
  return stats
}
