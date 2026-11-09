import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** How long a Session's derived projection checkpoint is kept after its last write. */
export const PROJECTION_CACHE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000

/**
 * The projection cache keeps one derived checkpoint per Session and the storage domain loads the whole directory at
 * boot: 325 MB of records measured 202.8 MB of heap on a full corpus, and 98 % of those bytes belong to Sessions idle
 * for over a week. A record dropped here is rebuilt from its log the next time that Session is opened.
 */
export const pruneProjectionCache = (input: { readonly now: number; readonly root?: string; readonly retentionMs?: number }): number => {
  const root = input.root ?? join(dshHomePath('storages', 'session_projcache'), 'sessions')
  const retention = input.retentionMs ?? PROJECTION_CACHE_RETENTION_MS
  let entries: readonly string[]
  try {
    entries = readdirSync(root)
  } catch {
    return 0
  }
  let removed = 0
  for (const entry of entries) {
    const path = join(root, entry)
    try {
      if (input.now - statSync(path).mtimeMs < retention) continue
      rmSync(path, { force: true })
      removed += 1
    } catch {
      continue
    }
  }
  return removed
}
