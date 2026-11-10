import { DshxPlugin, type EffectApiClient } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { threadActionsApi } from '@dshfiles/thread-sidebar/thread-actions-api'
import { Cause, Clock, Effect, Layer, Option, Schedule } from 'effect'
import type { BacklogLease } from './item-relations.js'
import { BacklogStore } from './store.js'

const THREAD_LOOKUP_CONCURRENCY = 4

/** What the sweep knows about a claim holder's thread: still live, archived, settled, or no longer listed at all. */
export type HolderThread = 'live' | 'archived' | 'settled' | 'gone'

/** The claims that end now, and why: an idle lease lapses, and so does one whose thread was archived, settled or is gone. */
const endings = (input: {
  readonly leases: readonly { readonly id: number; readonly lease: BacklogLease }[]
  readonly threads: ReadonlyMap<string, HolderThread>
  readonly now: number
}): { readonly id: number; readonly reason: string }[] =>
  input.leases.flatMap(entry => {
    if (entry.lease.expiresAt <= input.now) return [{ id: entry.id, reason: `claim by ${entry.lease.holder} lapsed after no write` }]
    const thread = input.threads.get(sessionOf(entry.lease.holder))
    if (thread === undefined || thread === 'live') return []
    return [{ id: entry.id, reason: `claim by ${entry.lease.holder} ended: its thread is ${thread}` }]
  })

const sessionOf = (holder: string): string => holder.replace(/^agent:/u, '')

type ThreadActionsClient = Pick<EffectApiClient<typeof threadActionsApi.methods>, 'list' | 'status'>

/**
 * Looks up one claim holder's thread with the point `status` call. A Host still running a thread-sidebar from before
 * `status` answers through the listing search instead. A failed lookup keeps the claim.
 */
const holderLookup =
  (input: { readonly threadActions: ThreadActionsClient; readonly hasStatus: boolean }) =>
  (sessionId: string): Effect.Effect<readonly [string, HolderThread]> => {
    const thread = input.hasStatus
      ? input.threadActions.status({ sessionIds: [sessionId] }).pipe(
          Effect.map((result): HolderThread => {
            const row = result.threads.find(candidate => candidate.sessionId === sessionId)
            if (row === undefined || !row.exists) return 'gone'
            if (row.archived) return 'archived'
            return row.settled ? 'settled' : 'live'
          }),
        )
      : input.threadActions.list({ query: sessionId, includeArchived: true, limit: 10 }).pipe(
          Effect.map((result): HolderThread => {
            const row = result.threads.find(candidate => candidate.sessionId === sessionId)
            if (row === undefined) return 'gone'
            if (row.archived) return 'archived'
            return row.settled ? 'settled' : 'live'
          }),
        )
    return thread.pipe(
      Effect.option,
      Effect.map(found => [sessionId, Option.getOrElse(found, (): HolderThread => 'live')] as const),
    )
  }

/**
 * One sweep: every live claim's thread is looked up (when `lookup` can answer), and each claim that lapsed or lost its
 * thread is released by the system, which returns its item to `todo`.
 */
const sweepOnce = Effect.fn('backlog lease sweep')(function* (input: {
  readonly store: BacklogStore['Service']
  readonly lookup: Option.Option<(sessionId: string) => Effect.Effect<readonly [string, HolderThread]>>
}) {
  const leases = yield* input.store.leases
  if (leases.length === 0) return 0
  const now = yield* Clock.currentTimeMillis
  const live = leases.filter(entry => entry.lease.expiresAt > now)
  const holders = Option.isSome(input.lookup) ? [...new Set(live.map(entry => sessionOf(entry.lease.holder)))] : []
  const threads = new Map(Option.isSome(input.lookup) ? yield* Effect.forEach(holders, input.lookup.value, { concurrency: THREAD_LOOKUP_CONCURRENCY }) : [])
  const ended = endings({ leases, threads, now })
  yield* Effect.annotateCurrentSpan({ 'dshx.backlog.leases': leases.length, 'dshx.backlog.leases_ended': ended.length })
  for (const end of ended) yield* input.store.release({ id: end.id, actor: { kind: 'system' }, reason: end.reason })
  return ended.length
})

/**
 * Ends claims nobody holds anymore, once a minute: a lapsed lease, or one whose thread was archived, settled or deleted.
 * The item returns to `todo` and the ready queue. Without thread-sidebar only the idle time ends a claim.
 */
export const LeaseSweep = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* BacklogStore
    const hostApis = yield* HostApis
    const threadActions = hostApis.client(threadActionsApi)

    const sweep = Effect.gen(function* () {
      const served = (yield* hostApis.list).find(api => api.owner === threadActionsApi.owner && api.id === threadActionsApi.id)
      if (served === undefined) return yield* sweepOnce({ store, lookup: Option.none() })
      const hasStatus = served.methods.some(method => method.name === 'status')
      return yield* sweepOnce({ store, lookup: Option.some(holderLookup({ threadActions, hasStatus })) })
    })

    const tick = sweep.pipe(
      Effect.catchCause(cause => (Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.logWarning('backlog lease sweep failed', cause))),
    )
    yield* DshxPlugin.worker(Effect.sleep('1 minute').pipe(Effect.andThen(Effect.repeat(tick, Schedule.spaced('1 minute')))))
  }),
)

export class LeaseEndings {
  static readonly endings = endings
  static readonly sweepOnce = sweepOnce
  static readonly holderLookup = holderLookup
}
