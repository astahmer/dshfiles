/**
 * The one duration grammar (DESIGN.md › Durations). No space before the unit, `s`/`m`/`h` untranslated, whole seconds
 * rounded down, and seconds padded after minutes and minutes after hours so a ticking clock keeps its width.
 */

/** Time someone waited (a turn, a tool call, a job, a subagent, an open question): `9s`, `2m 05s`, `1h 04m`. */
export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${String(total)}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${String(minutes)}m ${String(total % 60).padStart(2, '0')}s`
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** A measured span in a table, a trace or a test report: `250µs`, `4.5ms`, `420ms`, `1.5s`, `42s`, `3m 05s`, `2h 10m`. */
export const formatDurationMs = (milliseconds: number): string => {
  const ms = Math.max(0, milliseconds)
  if (ms < 0.9995) return `${String(Math.round(ms * 1000))}µs`
  if (ms < 9.95) return `${String(Number(ms.toFixed(1)))}ms`
  if (ms < 999.5) return `${String(Math.round(ms))}ms`
  if (ms < 9_950) return `${(ms / 1000).toFixed(1)}s`
  // From here whole seconds, floored; `9.95s`–`10s` reads `10s`, the value the one-decimal form rounds up to.
  if (ms < 10_000) return '10s'
  return formatElapsed(ms)
}
