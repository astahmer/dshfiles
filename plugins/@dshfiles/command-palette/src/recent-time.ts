const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/**
 * When a recent thread last moved (round five B6): today's in whole units, as the thread list says them ("now", "2m",
 * "3h"), an older one by its date. A full date on every row of today's recents read as noise.
 */
export const recentTime = (updatedAt: number, now: number = Date.now()): string => {
  const then = new Date(updatedAt)
  if (then.toDateString() !== new Date(now).toDateString()) return then.toLocaleDateString()
  const elapsed = Math.max(0, now - updatedAt)
  if (elapsed < MINUTE_MS) return 'now'
  return elapsed < HOUR_MS ? `${String(Math.floor(elapsed / MINUTE_MS))}m` : `${String(Math.floor(elapsed / HOUR_MS))}h`
}
