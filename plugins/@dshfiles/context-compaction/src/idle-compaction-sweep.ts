import type { SessionId } from '@dshfiles/dshx/ids'
import { withSpan } from '@dshfiles/dshx/tracing'
import { IdleCompactionModel, type IdleCompactionPolicy } from './idle-compaction.js'

export interface IdleCompactionCandidate {
  readonly sessionId: SessionId
  /** The idle start this Host observed itself, or null when it never saw one (a cold or unknown timestamp). */
  readonly lastActivityAt: number | null
  readonly tokens: number | null
  /** Re-read immediately before the billed request: false when the thread gained activity, a turn, or queued input. */
  readonly stillIdle: () => boolean
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
  /** The idle start of the last attempt for each thread, recorded before the request so a failure never rebills it. */
  readonly attemptedAt: ReadonlyMap<SessionId, number>
  readonly policy: IdleCompactionPolicy
  readonly onAttempt?: (input: { readonly sessionId: SessionId; readonly lastActivityAt: number }) => void
  readonly onFailure?: (input: { readonly sessionId: SessionId; readonly error: unknown }) => void
}): Promise<readonly SessionId[]> =>
  withSpan('context compaction idle sweep', { attributes: { candidates: input.candidates.length } }, async () => {
    if (!input.policy.enabled) return []
    const compacted: SessionId[] = []
    for (const candidate of input.candidates) {
      const due = IdleCompactionModel.due({
        now: input.now,
        lastActivityAt: candidate.lastActivityAt,
        attemptedAt: input.attemptedAt.get(candidate.sessionId) ?? null,
        tokens: candidate.tokens,
        policy: input.policy,
      })
      if (!due || candidate.lastActivityAt === null) continue
      try {
        if (!candidate.stillIdle()) continue
        // One billed request per idle stretch: record the attempt before calling, so a provider failure is not retried.
        input.onAttempt?.({ sessionId: candidate.sessionId, lastActivityAt: candidate.lastActivityAt })
        await candidate.compact()
        compacted.push(candidate.sessionId)
      } catch (error: unknown) {
        input.onFailure?.({ sessionId: candidate.sessionId, error })
      }
    }
    return compacted
  })
