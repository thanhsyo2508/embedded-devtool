/** Coarse "Ns/m/h ago" label shared by every per-message timeline (MQTT
 * history, UDP packet log, WS frame log) — precise enough for a live feed
 * without re-rendering every second for a value nobody reads that closely. */
export function relativeTime(atMs: number, nowMs: number): string {
  const deltaS = Math.max(0, Math.round((nowMs - atMs) / 1000))
  if (deltaS < 1) return 'now'
  if (deltaS < 60) return `${deltaS}s ago`
  const deltaM = Math.round(deltaS / 60)
  if (deltaM < 60) return `${deltaM}m ago`
  return `${Math.round(deltaM / 60)}h ago`
}
