import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { JobEvent, JobView } from '@deepseek-ai/dsh-jobs'
import type { JobChunk } from '@deepseek-ai/dsh-jobs/view'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { hostServiceChanges } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Option, Queue, Stream, SubscriptionRef } from 'effect'

/**
 * The slice of `ctx.jobs` the board reads. The registry fences every read by
 * the owner, so a cross-Session board passes the owner back as the caller —
 * exactly what the stock per-Session job list does on a human's behalf.
 */
export interface JobRegistrySurface {
  readonly events: {
    subscribe(filter: { readonly owners: 'all' }, listener: (event: JobEvent) => void): () => void
  }
  readAt(id: JobId, from: number, caller?: SessionId): { readonly chunks: readonly JobChunk[]; readonly next: number; readonly lossy: boolean }
  kill(id: JobId, caller?: SessionId, reason?: string): 'requested' | 'already-finished'
}

/** The Host's job registry as it comes and goes; the board keeps listing history while it is absent. */
export class JobRegistry extends Context.Service<JobRegistry, { readonly changes: Stream.Stream<Option.Option<JobRegistrySurface>> }>()(
  '@dshfiles/background-jobs/JobRegistry',
) {
  static readonly layer = Layer.effect(
    JobRegistry,
    Effect.map(hostServiceChanges('jobs'), changes => JobRegistry.of({ changes })),
  )
}

export interface LiveJobsState {
  readonly registry: Option.Option<JobRegistrySurface>
  readonly views: ReadonlyMap<string, JobView>
  /** Registry events and swaps applied so far; a reader waits on it to see the effect of its own event. */
  readonly revision: number
}

const applyEvent =
  (event: JobEvent) =>
  (state: LiveJobsState): LiveJobsState => {
    const views = new Map(state.views)
    if (event.type === 'removed') views.delete(event.job.id)
    if (event.type === 'output') {
      const previous = views.get(event.id)
      if (previous !== undefined) views.set(event.id, { ...previous, output: { ...previous.output, total: event.total } })
    }
    if (event.type !== 'removed' && event.type !== 'output') views.set(event.job.id, event.job)
    return { registry: state.registry, views, revision: state.revision + 1 }
  }

const nextRevision = (state: LiveJobsState): LiveJobsState => ({ ...state, revision: state.revision + 1 })

/** Swap to `registry` with no views, subscribe, then publish the swap: no event is applied before the swap clears the views. */
const followRegistry = (input: { readonly state: SubscriptionRef.SubscriptionRef<LiveJobsState>; readonly registry: Option.Option<JobRegistrySurface> }) =>
  Stream.callback<JobEvent>(queue =>
    Effect.gen(function* () {
      yield* SubscriptionRef.update(input.state, previous => ({ registry: input.registry, views: new Map(), revision: previous.revision }))
      if (Option.isSome(input.registry)) {
        const registry = input.registry.value
        yield* Effect.acquireRelease(
          Effect.sync(() => registry.events.subscribe({ owners: 'all' }, event => Queue.offerUnsafe(queue, event))),
          unsubscribe => Effect.sync(unsubscribe),
        )
      }
      yield* SubscriptionRef.update(input.state, nextRevision)
    }),
  ).pipe(Stream.mapEffect(event => SubscriptionRef.update(input.state, applyEvent(event))))

/** Live jobs of every Session in this process, kept current from registry events. */
export class LiveJobs extends Context.Service<
  LiveJobs,
  {
    readonly state: Effect.Effect<LiveJobsState>
    /** The current state, then every state after a registry event or a registry swap. */
    readonly changes: Stream.Stream<LiveJobsState>
  }
>()('@dshfiles/background-jobs/LiveJobs') {
  static readonly layer = Layer.effect(
    LiveJobs,
    Effect.gen(function* () {
      const registry = yield* JobRegistry
      const state = yield* SubscriptionRef.make<LiveJobsState>({ registry: Option.none(), views: new Map(), revision: 0 })
      yield* registry.changes.pipe(
        Stream.switchMap(current => followRegistry({ state, registry: current })),
        Stream.runDrain,
        Effect.forkScoped,
      )
      return LiveJobs.of({ state: SubscriptionRef.get(state), changes: SubscriptionRef.changes(state) })
    }),
  )
}
