import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type { ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-session-title'
import { formatSessionReferenceMention } from '@deepseek-ai/dsh-session-reference'
import type {} from '@deepseek-ai/dsh-subagent'
import { HostContext } from '@dshfiles/dshx/effect'
import { pluginAttributes } from '@dshfiles/dshx/tracing'
import { Effect } from 'effect'
import * as Result from 'effect/Result'
import type { ThreadMentionCandidateAnswer, ThreadMentionCandidateRequest } from './mention-candidate-api.js'
import { statStoredThread } from './mention-candidate-promise.js'

/** The projection keys the reference resolver labels candidates from; a projection cache answers the same label. */
const LABEL_KEYS = ['title', 'subagent'] as const

const answer = (snapshot: ProjectionSnapshot | undefined, sessionId: SessionId): ThreadMentionCandidateAnswer => {
  const label = snapshot?.values.title ?? sessionId
  const displayTitle = snapshot?.values.subagent?.label ?? label
  return {
    candidate: {
      sessionId,
      label,
      displayTitle,
      mention: formatSessionReferenceMention({ sessionId, label: displayTitle }),
    },
  }
}

/**
 * Resolve the one Session a thread menu action names into the canonical mention it inserts.
 *
 * The native reference resolver lists and labels the whole Session corpus per call, which costs hundreds of
 * milliseconds on a long-lived install; this reads the one requested header by id and its projection-backed label.
 * @param input - the target Session and the agent whose composer receives the mention.
 * @returns its canonical mention, or the reason it has none.
 */
export const resolveThreadMentionCandidate = (input: ThreadMentionCandidateRequest) => {
  const run = Effect.gen(function* () {
    if (input.agentSessionId === input.sessionId) return { reason: 'self' as const }
    const { ctx } = yield* HostContext
    const target = SessionId(input.sessionId)
    const live = ctx.agents.list().find(candidate => String(candidate.id) === input.sessionId)?.session
    if (live !== undefined) return answer(ctx.sessionProjections.snapshot(live, LABEL_KEYS), live.header.id)
    const read = yield* Effect.result(statStoredThread({ ctx, sessionId: target }))
    if (Result.isFailure(read)) return { reason: 'unavailable' as const }
    const stored = read.success
    if (stored === undefined) return { reason: 'missing' as const }
    return answer(ctx.get('sessionProjectionCache')?.cachedSnapshot(stored.header, LABEL_KEYS), stored.header.id)
  })
  return run.pipe(
    Effect.withSpan('thread mention resolve', {
      attributes: {
        'dsh.session.id': input.sessionId,
        ...pluginAttributes({ plugin: 'thread-sidebar', attributes: { mention_self: input.agentSessionId === input.sessionId } }),
      },
    }),
  )
}
