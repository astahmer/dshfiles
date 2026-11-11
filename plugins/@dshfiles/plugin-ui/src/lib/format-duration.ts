/** `250µs`, `4.5ms`, `420ms`, `1.5s`, `42s`, `3m 5s`, `2h 10m`. */
export const formatDurationMs = (milliseconds: number): string => {
  const ms = Math.max(0, milliseconds)
  if (ms < 0.9995) return `${String(Math.round(ms * 1000))}µs`
  if (ms < 9.95) return `${String(Number(ms.toFixed(1)))}ms`
  if (ms < 999.5) return `${String(Math.round(ms))}ms`
  if (ms < 9_950) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${String(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(seconds % 60)}s`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(minutes % 60)}m`
}
