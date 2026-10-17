/** How many review scopes one browser keeps marks for; the rest are evicted oldest-first. */
export const MAX_REVIEWED_KEYS = 20

/**
 * Reviewed marks are keyed by workspace, base and working-copy revision, so a
 * new revision — or a base that moved under the same `@` — starts unreviewed.
 */
const reviewedKeyOf = (path: string, base: string, head: string): string => `${path}\u0000${base}\u0000${head}`

const toggleReviewed = (paths: readonly string[], path: string): string[] => (paths.includes(path) ? paths.filter(entry => entry !== path) : [...paths, path])

/** Write one key and drop the least recently touched ones, so localStorage stays bounded. */
const recordReviewed = (record: Readonly<Record<string, readonly string[]>>, key: string, paths: readonly string[]) => {
  const next: Record<string, string[]> = {}
  for (const [existing, value] of Object.entries(record)) if (existing !== key) next[existing] = [...value]
  next[key] = [...paths]
  const keys = Object.keys(next)
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_REVIEWED_KEYS))) delete next[stale]
  return next
}

export class ReviewedMarksModel {
  static readonly keyOf = reviewedKeyOf
  static readonly toggle = toggleReviewed
  static readonly record = recordReviewed
}
