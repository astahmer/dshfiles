/** An index nobody searched for this long is dropped; every jj thread workspace is its own root. */
export const IDLE_INDEX_MS = 30 * 60_000

export interface EvictionCandidate {
  readonly lastUsedAt: number
  readonly inUse: number
}

/** A query holds its index's FFI handle, so destroying it mid-flight is never safe. */
export const evictableIndex = (candidate: EvictionCandidate, now: number): boolean => candidate.inUse === 0 && now - candidate.lastUsedAt >= IDLE_INDEX_MS
