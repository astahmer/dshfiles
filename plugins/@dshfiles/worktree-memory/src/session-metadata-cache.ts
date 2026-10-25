import { withSpan } from '@dshfiles/dshx/tracing'
import type { KnownSession } from './process-table.js'

const SUCCESS_TTL_MS = 30_000
const FAILURE_TTL_MS = 45_000

export interface SessionMetadataCache {
  read(refresh: () => Promise<readonly KnownSession[] | undefined>): readonly KnownSession[]
  refresh(refresh: () => Promise<readonly KnownSession[] | undefined>): Promise<void>
}

export const createSessionMetadataCache = (now: () => number = Date.now): SessionMetadataCache => {
  let value: readonly KnownSession[] = []
  let refreshAt = 0
  let pending: Promise<void> | null = null

  const refreshSessions = (load: () => Promise<readonly KnownSession[] | undefined>): Promise<void> => {
    if (pending !== null) return pending
    if (now() < refreshAt) return Promise.resolve()

    pending = withSpan('worktree-memory list sessions', { kind: 'internal' }, () => Promise.resolve().then(load))
      .then(sessions => {
        if (sessions === undefined) {
          refreshAt = now() + FAILURE_TTL_MS
          return
        }
        value = sessions
        refreshAt = now() + SUCCESS_TTL_MS
      })
      .catch(() => {
        refreshAt = now() + FAILURE_TTL_MS
      })
      .finally(() => {
        pending = null
      })
    return pending
  }

  return {
    read: load => {
      void refreshSessions(load)
      return value
    },
    refresh: refreshSessions,
  }
}
