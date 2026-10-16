/**
 * Reviewed marks are keyed by workspace and working-copy revision, so a new
 * revision on the same path starts unreviewed.
 */
export const reviewedKeyOf = (path: string, head: string): string => `${path}\u0000${head}`

export const toggleReviewed = (paths: readonly string[], path: string): string[] =>
  paths.includes(path) ? paths.filter(entry => entry !== path) : [...paths, path]
