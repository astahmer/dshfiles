import { attentionApi, type AttentionDraft } from '@dshfiles/activity-timeline/attention-api'
import { DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Effect, Layer, Stream } from 'effect'
import type { ThreadAttentionView } from './attention-api.js'
import { ThreadAttention } from './attention-store.js'

/** The inbox source of finished turns the user has not opened yet. */
export const FINISHED_TURN_SOURCE = 'thread-sidebar.finished-turn'

const RECONCILE_DEBOUNCE = '250 millis'

const FINISH_COPY = {
  completed: { reason: 'Turn finished; ready to review.', severity: 'ready' },
  aborted: { reason: 'Turn stopped before it finished.', severity: 'ready' },
  blocked: { reason: 'Turn ended without running a step.', severity: 'ready' },
  error: { reason: 'Turn failed.', severity: 'failed' },
  'max-tokens': { reason: 'Turn stopped at the output token limit.', severity: 'failed' },
} as const satisfies Record<NonNullable<ThreadAttentionView['finishedReason']>, { readonly reason: string; readonly severity: 'ready' | 'failed' }>

/**
 * One unacknowledged thread as an inbox item. Each finished turn is its own occurrence (keyed by the turn's sequence),
 * so a later turn shows again even after the user marked an earlier one done; a hand-made unread mark is one item.
 */
const draftOf = (view: ThreadAttentionView): AttentionDraft | null => {
  if (view.finishedAt !== null && view.finishedReason !== null) {
    const copy = FINISH_COPY[view.finishedReason]
    return {
      dedupeKey: `${view.sessionId}:turn:${String(view.finishedSeq ?? view.finishedAt)}`,
      subject: { kind: 'session', id: view.sessionId },
      reason: copy.reason,
      severity: copy.severity,
      verbs: ['Open', 'Done', 'Snooze', 'MuteSource'],
    }
  }
  if (view.manuallyUnread) {
    return {
      dedupeKey: `${view.sessionId}:unread`,
      subject: { kind: 'session', id: view.sessionId },
      reason: 'Marked unread.',
      severity: 'ready',
      verbs: ['Open', 'Done', 'Snooze', 'MuteSource'],
    }
  }
  return null
}

const draftsOf = (views: Iterable<ThreadAttentionView>): readonly AttentionDraft[] =>
  [...views].flatMap(view => {
    const draft = draftOf(view)
    return draft === null ? [] : [draft]
  })

const make = Effect.gen(function* () {
  const attention = yield* ThreadAttention
  const apis = yield* HostApis
  const inbox = apis.client(attentionApi)

  /** Opening a thread acknowledges it here, so its item resolves in the inbox on the next reconcile. */
  const reconcile = Effect.fn('thread-sidebar attention reconcile')(function* () {
    if (!(yield* apis.isServed(attentionApi))) return
    const items = draftsOf((yield* attention.snapshot).sessions)
    yield* Effect.annotateCurrentSpan({ 'attention.items': items.length })
    yield* inbox.reconcile({ source: FINISHED_TURN_SOURCE, items: [...items] })
  })

  yield* Stream.mergeAll([Stream.succeed(undefined), Stream.map(HostEvents.stream('dshfiles/attention/ready'), () => undefined), attention.changes], {
    concurrency: 'unbounded',
  }).pipe(
    Stream.debounce(RECONCILE_DEBOUNCE),
    Stream.runForEach(() => reconcile().pipe(Effect.catchCause(cause => Effect.logWarning('thread-sidebar: inbox reconcile failed', cause)))),
    DshxPlugin.detached,
    Effect.forkScoped,
  )
})

/** thread-sidebar as an inbox provider: unacknowledged finished turns are Ready (or Failed) items. */
export class FinishedTurnAttention {
  static readonly layer = Layer.effectDiscard(make)
  static readonly draftsOf = draftsOf
}
