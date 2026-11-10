import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** An index nobody searched for this long is dropped; every jj thread workspace is its own root. */
export const IDLE_INDEX_MS = 30 * 60_000

export interface EvictionCandidate {
  readonly lastUsedAt: number
  readonly inUse: number
}

/** A query holds its index's FFI handle, so destroying it mid-flight is never safe. */
export const evictableIndex = (candidate: EvictionCandidate, now: number): boolean => candidate.inUse === 0 && now - candidate.lastUsedAt >= IDLE_INDEX_MS

/**
 * Drop the per-root stores whose recorded root no longer exists — a deleted thread workspace leaves its search history
 * behind otherwise (2,099 of 2,152 stores here were dead). A store written before the marker existed has no recorded
 * root and is left alone rather than guessed at.
 */
export const pruneStores = (stateRoot: string): number => {
  if (!existsSync(stateRoot)) return 0
  let removed = 0
  for (const entry of readdirSync(stateRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = join(stateRoot, entry.name)
    let root: string
    try {
      root = readFileSync(join(directory, 'root.txt'), 'utf8').trim()
    } catch {
      continue
    }
    if (root.length === 0 || existsSync(root)) continue
    rmSync(directory, { recursive: true, force: true })
    removed += 1
  }
  return removed
}
