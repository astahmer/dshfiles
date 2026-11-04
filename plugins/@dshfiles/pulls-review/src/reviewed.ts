import { Schema } from 'effect'
import { MAX_FILES } from './api.js'

/** How many review scopes the Host keeps marks for; the rest are evicted oldest-first. */
export const MAX_REVIEWED_KEYS = 20

const reviewedMarksSchema = Schema.Record(Schema.String, Schema.Array(Schema.String.check(Schema.isMaxLength(2048))).check(Schema.isMaxLength(MAX_FILES)))
export type ReviewedMarks = typeof reviewedMarksSchema.Type

/**
 * Reviewed marks are keyed by workspace, base and working-copy revision, so a
 * new revision — or a base that moved under the same `@` — starts unreviewed.
 */
const reviewedKeyOf = (path: string, base: string, head: string): string => `${path}\u0000${base}\u0000${head}`

const toggleReviewed = (paths: readonly string[], path: string): string[] => (paths.includes(path) ? paths.filter(entry => entry !== path) : [...paths, path])

/** Write one key and drop the least recently touched ones, so the stored record stays bounded. */
const recordReviewed = (record: Readonly<Record<string, readonly string[]>>, key: string, paths: readonly string[]) => {
  const next: Record<string, string[]> = {}
  for (const [existing, value] of Object.entries(record)) if (existing !== key) next[existing] = [...value]
  next[key] = [...paths]
  const keys = Object.keys(next)
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_REVIEWED_KEYS))) delete next[stale]
  return next
}

/** A range mark target in diff-viewed's store; restated here as data only, so the migration stays a pure function. */
export interface ReviewedRangeTarget {
  readonly kind: 'range'
  readonly workspacePath: string
  readonly base: string
  readonly head: string
  readonly path: string
}

/**
 * The record this plugin kept before diff-viewed owned every viewed mark, as the range targets that carry the same
 * meaning there: workspace, base and head commit, one target per reviewed path. Malformed keys are skipped.
 */
const migrationTargets = (record: Readonly<Record<string, readonly string[]>>): readonly ReviewedRangeTarget[] => {
  const targets: ReviewedRangeTarget[] = []
  for (const [key, paths] of Object.entries(record)) {
    const [workspacePath = '', base = '', head = '', ...rest] = key.split('\u0000')
    if (rest.length > 0 || workspacePath === '' || base === '' || head === '') continue
    for (const path of paths) if (path.length > 0) targets.push({ kind: 'range', workspacePath, base, head, path })
  }
  return targets
}

export class ReviewedMarksModel {
  static readonly migrationTargets = migrationTargets
  static readonly schema = reviewedMarksSchema
  /** Where marks lived before they moved to the Host; read once, then removed. */
  static readonly legacyBrowserKey = 'dshfiles-pulls-review:reviewed'
  static readonly keyOf = reviewedKeyOf
  static readonly toggle = toggleReviewed
  static readonly record = recordReviewed

  static mark(paths: readonly string[], additions: readonly string[]): string[] {
    return [...new Set([...paths, ...additions])]
  }

  static unmark(paths: readonly string[], removals: readonly string[]): string[] {
    const removed = new Set(removals)
    return paths.filter(path => !removed.has(path))
  }
}
