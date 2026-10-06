import type { UsageCard } from './api.js'

export const knownQuotaResetAt = (usage: UsageCard, now: number): number | null => {
  if (usage.status !== 'ok' || !Number.isSafeInteger(now) || now < 0) return null

  let exhaustedWindows = 0
  let latestResetAt: number | undefined
  for (const window of usage.windows) {
    if (!Number.isFinite(window.percentRemaining)) return null
    if (window.percentRemaining > 0) continue

    exhaustedWindows += 1
    if (window.resetsAt === null || !Number.isSafeInteger(window.resetsAt) || window.resetsAt <= now) return null
    latestResetAt = Math.max(latestResetAt ?? window.resetsAt, window.resetsAt)
  }

  if (exhaustedWindows === 0) return null
  return latestResetAt ?? null
}
