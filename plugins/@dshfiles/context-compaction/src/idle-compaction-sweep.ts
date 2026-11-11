import type { SessionId } from '@dshfiles/dshx/ids'
import { withSpan } from '@dshfiles/dshx/tracing'
import { IdleCompactionModel, type IdleCompactionPolicy } from './idle-compaction.js'

export interface IdleCompactionCandidate {
  readonly sessionId: SessionId
  /** When this thread last wrote to its log or changed agent status. */
  readonly lastActivityAt: number
  readonly tokens: number | null
  /** The engine's own idle compaction admission; refuses a thread it cannot own. */
  readonly compact: () => Promise<unknown>
}

/**
 * One pass over the resident threads. Only a thread this Host still holds can be compacted here: a cold thread is
 * the Session controller's to resume, so it is not listed instead of being resumed behind its owner's back.
 */
export const sweepIdleCompaction = (input: {
  readonly now: number
  readonly candidates: readonly IdleCompactionCandidate[]
  readonly compactedAt: ReadonlyMap<SessionId, number>
  readonly policy: IdleCompactionPolicy
  readonly onFailure?: (input: { readonly sessionId: SessionId; readonly error: unknown }) => void
}): Promise<readonly SessionId[]> =>
  withSpan('context compaction idle sweep', { attributes: { candidates: input.candidates.length } }, async () => {
    if (!input.policy.enabled) return []
    const compacted: SessionId[] = []
    for (const candidate of input.candidates) {
      const due = IdleCompactionModel.due({
        now: input.now,
        lastActivityAt: candidate.lastActivityAt,
        compactedAt: input.compactedAt.get(candidate.sessionId) ?? null,
        tokens: candidate.tokens,
        policy: input.policy,
      })
      if (!due) continue
      try {
        await candidate.compact()
        compacted.push(candidate.sessionId)
      } catch (error: unknown) {
        input.onFailure?.({ sessionId: candidate.sessionId, error })
      }
    }
    return compacted
  })
