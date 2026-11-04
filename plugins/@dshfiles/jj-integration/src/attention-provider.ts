import { attentionApi, type AttentionActOutcome, type AttentionActRequest, type AttentionDraft } from '@dshfiles/activity-timeline/attention-api'
import { DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Clock, Context, Effect, Layer, Queue, Ref, Stream } from 'effect'
import type { RepositoryView, ThreadView } from './api.js'
import { Landing, LandingMessages } from './landing.js'
import { RepositoryViews } from './repository-views.js'
import { ThreadIntegrationModel } from './thread-integration-state.js'
import { handleAttentionActs } from './attention-act-promise.js'

/** Thread workspaces whose revisions conflict, or whose queued land stopped: Land is blocked. */
export const LAND_BLOCKED_SOURCE = 'jj-integration.land-blocked'
/** Idle thread workspaces with described revisions not yet on the bookmark. */
export const READY_TO_LAND_SOURCE = 'jj-integration.ready-to-land'

const RECONCILE_DEBOUNCE = '500 millis'
/** Session events arrive in bursts while a turn streams; a finished turn can make a workspace ready. */
const SESSION_SETTLE = '5 seconds'
/**
 * A repository scan costs jj processes per thread, so the safety pass is slow; the views cache answers in between and
 * scans again at most once per minute.
 */
const RECONCILE_SAFETY_INTERVAL = '2 minutes'

const clamp = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1)}…`)
const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? '' : 's'}`

/** A queued land that stopped for another reason than a busy thread; in memory, so a restart forgets it. */
export interface QueuedLandFailure {
  readonly path: string
  readonly message: string
  readonly at: number
}

const titleOf = (thread: ThreadView): string => thread.workspaceTitle ?? thread.name

/** The thread's newest conversation, so Open lands on it; a workspace nobody opened is named by its title. */
const subjectOf = (thread: ThreadView): AttentionDraft['subject'] => {
  const sessionId = thread.sessionIds.at(-1)
  return sessionId === undefined ? { kind: 'workspace', id: clamp(thread.path, 512), label: clamp(titleOf(thread), 200) } : { kind: 'session', id: sessionId }
}

/**
 * The inbox items one thread workspace states, from the same assessment the integration dashboard uses: conflicts are
 * Failed (Land blocked), an idle workspace whose described work is not landed is Ready. Busy, queued, unknown and
 * landed workspaces state nothing.
 */
const draftsOfThread = (thread: ThreadView, failure: QueuedLandFailure | undefined): readonly AttentionDraft[] => {
  if (thread.missing) return []
  const assessment = ThreadIntegrationModel.assess({ thread, running: false, waitingForInput: false, integrationAllowed: thread.canRebase })
  const title = titleOf(thread)
  const subject = subjectOf(thread)
  if (assessment.category === 'conflicts') {
    const conflicted = thread.unlanded.filter(revision => revision.conflict).map(revision => revision.changeId.slice(0, 12))
    return [
      {
        dedupeKey: `${thread.path}:conflict`,
        subject,
        reason: clamp(`“${title}” has ${plural(assessment.conflictedRevisions, 'conflicted revision')}; Land is blocked.`, 500),
        detail: clamp(
          `Conflicted: ${conflicted.join(', ')}. Resolve them in the thread (ask its agent, or run jj resolve in the workspace), then Retry.`,
          2000,
        ),
        severity: 'failed',
        verbs: ['Retry', 'Open', 'Done', 'Snooze', 'MuteSource'],
      },
    ]
  }
  if (failure !== undefined && thread.unlanded.length > 0) {
    return [
      {
        dedupeKey: `${thread.path}:queued-land`,
        subject,
        reason: clamp(`The queued land of “${title}” stopped before rebasing.`, 500),
        detail: clamp(`${failure.message} Fix the cause, then Retry.`, 2000),
        severity: 'failed',
        verbs: ['Retry', 'Open', 'Done', 'Snooze', 'MuteSource'],
      },
    ]
  }
  if (assessment.category === 'ready' && thread.integrationQueuedAt === undefined) {
    return [
      {
        dedupeKey: `${thread.path}:ready`,
        subject,
        reason: clamp(`“${title}” is ready to land: ${plural(assessment.pendingRevisions, 'described revision')} not on the bookmark yet.`, 500),
        severity: 'ready',
        verbs: ['Land', 'Open', 'Done', 'Snooze', 'MuteSource'],
      },
    ]
  }
  return []
}

const draftsOf = (repositories: readonly RepositoryView[], failures: ReadonlyMap<string, QueuedLandFailure>) => {
  const blocked: AttentionDraft[] = []
  const ready: AttentionDraft[] = []
  for (const repository of repositories)
    for (const thread of repository.threads)
      for (const draft of draftsOfThread(thread, failures.get(thread.path))) (draft.severity === 'ready' ? ready : blocked).push(draft)
  return { blocked, ready }
}

const refused = (message: string): AttentionActOutcome => ({ ok: false, message })

const pathOf = (request: AttentionActRequest): string => request.item.dedupeKey.replace(/:(?:conflict|queued-land|ready)$/u, '')

const make = Effect.gen(function* () {
  const views = yield* RepositoryViews
  const landing = yield* Landing
  const apis = yield* HostApis
  const inbox = apis.client(attentionApi)
  const failures = yield* Ref.make<ReadonlyMap<string, QueuedLandFailure>>(new Map())
  const pokes = yield* Queue.sliding<void>(1)

  /** State every blocked and ready workspace; a stale view is read fresh first, so a fixed conflict leaves the inbox. */
  const reconcile = Effect.fn('jj-integration attention reconcile')(function* () {
    if (!(yield* apis.isServed(attentionApi))) return
    const snapshot = yield* views.snapshot
    if (snapshot.refreshFailed) return
    const repositories = snapshot.refreshing ? yield* views.list : snapshot.repositories
    const { blocked, ready } = draftsOf(repositories, yield* Ref.get(failures))
    yield* Effect.annotateCurrentSpan({ 'attention.blocked': blocked.length, 'attention.ready': ready.length })
    yield* inbox.reconcile({ source: LAND_BLOCKED_SOURCE, items: blocked })
    yield* inbox.reconcile({ source: READY_TO_LAND_SOURCE, items: ready })
  })

  /** Land and Retry run the same guarded land the dashboard's button runs, only because the user chose it. */
  const act = Effect.fn('jj-integration attention act')(function* (request: AttentionActRequest) {
    if (request.verb !== 'Land' && request.verb !== 'Retry') return refused('Workspace items take Land or Retry here; open the thread for anything else.')
    const path = pathOf(request)
    const outcome = yield* landing.land({ path, sessionId: undefined, fromAgent: false }).pipe(Effect.result)
    yield* Ref.update(failures, current => {
      const next = new Map(current)
      next.delete(path)
      return next
    })
    yield* Queue.offer(pokes, undefined)
    if (outcome._tag === 'Failure') {
      if (outcome.failure._tag === 'IntegrationQueued') return { ok: true, message: 'Queued: it lands as soon as every thread in the workspace is idle.' }
      return refused(outcome.failure.message)
    }
    const result = outcome.success
    if (result.status === 'landed') return { ok: true, message: `Landed ${plural(result.revisions.length, 'revision')} on ${result.bookmark}.` }
    return refused(LandingMessages.forResult(result) ?? `Nothing landed (${result.status}).`)
  })

  const owns = (source: string): boolean => source === LAND_BLOCKED_SOURCE || source === READY_TO_LAND_SOURCE
  yield* handleAttentionActs(request =>
    owns(request.item.source)
      ? act(request).pipe(Effect.catchCause(() => Effect.succeed(refused('Landing failed on the Host. Open the Land view and try there.'))))
      : Effect.succeed(undefined),
  )

  yield* Stream.mergeAll(
    [
      Stream.succeed(undefined),
      Stream.map(HostEvents.stream('dshfiles/attention/ready'), () => undefined),
      Stream.map(HostEvents.stream('session/event').pipe(Stream.debounce(SESSION_SETTLE)), () => undefined),
      Stream.fromQueue(pokes),
      Stream.map(Stream.tick(RECONCILE_SAFETY_INTERVAL), () => undefined),
    ],
    { concurrency: 'unbounded' },
  ).pipe(
    Stream.debounce(RECONCILE_DEBOUNCE),
    Stream.runForEach(() => reconcile().pipe(Effect.catchCause(cause => Effect.logWarning('jj-integration: inbox reconcile failed', cause)))),
    DshxPlugin.detached,
    Effect.forkScoped,
  )

  return {
    /** Re-read the workspaces now, e.g. after a land from the Changes facet or the Land view, so a landed item resolves at once. */
    refresh: Queue.offer(pokes, undefined).pipe(Effect.asVoid),
    /** A queued land stopped: say so in the inbox until a land of that workspace is tried again. */
    queuedLandFailed: (path: string, message: string) =>
      Effect.flatMap(Clock.currentTimeMillis, at =>
        Ref.update(failures, current => new Map([...current, [path, { path, message, at }]])).pipe(Effect.andThen(Queue.offer(pokes, undefined))),
      ),
    queuedLandSucceeded: (path: string) =>
      Ref.update(failures, current => {
        if (!current.has(path)) return current
        const next = new Map(current)
        next.delete(path)
        return next
      }).pipe(Effect.andThen(Queue.offer(pokes, undefined))),
  }
})

/** jj-integration as an inbox provider: conflicted or stopped lands are Failed, idle described work is Ready to land. */
export class LandAttention extends Context.Service<LandAttention, Effect.Success<typeof make>>()('@dshfiles/jj-integration/LandAttention') {
  static readonly layer = Layer.effect(LandAttention, make)
  static readonly draftsOf = draftsOf
}
