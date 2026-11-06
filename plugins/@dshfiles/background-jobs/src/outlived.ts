import type {} from '@deepseek-ai/dsh-agent'
import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { JobView } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { HostContext } from '@dshfiles/dshx/effect'
import { Clock, Context, Effect, Layer, Option, Stream, SubscriptionRef } from 'effect'
import { LiveJobs } from './live.js'
import { backgroundJobsSettings, type BackgroundJobsSettings } from './settings.js'

const MINUTE_MS = 60_000

/** Which Sessions run a turn right now; `None` when the Host's agent registry cannot be read, so nothing counts as outlived. */
export class TurnActivity extends Context.Service<TurnActivity, { readonly runningSessionIds: Effect.Effect<Option.Option<ReadonlySet<string>>> }>()(
  '@dshfiles/background-jobs/TurnActivity',
) {
  static readonly layer = Layer.effect(
    TurnActivity,
    Effect.map(HostContext, host =>
      TurnActivity.of({
        runningSessionIds: Effect.sync(() => {
          const agents = host.ctx.get('agents')
          if (agents === undefined || agents === null) return Option.none()
          return Option.some(
            new Set(
              agents
                .list()
                .filter(agent => agent.status === 'running')
                .map(agent => String(agent.id)),
            ),
          )
        }),
      }),
    ),
  )
}

/**
 * A live job outlived its turn once its owner Session stopped running: the thread finished, settled or was archived,
 * so no turn is left to read the job. `since` is when that was first observed and is cleared when the owner runs again.
 */
const observe = (input: {
  readonly previous: ReadonlyMap<string, number>
  readonly views: Iterable<JobView>
  readonly runningSessionIds: ReadonlySet<string>
  readonly now: number
}): ReadonlyMap<string, number> => {
  const next = new Map<string, number>()
  for (const view of input.views) {
    if (view.owner === undefined || (view.status !== 'running' && view.status !== 'stopping')) continue
    if (input.runningSessionIds.has(String(view.owner))) continue
    next.set(view.id, input.previous.get(view.id) ?? input.now)
  }
  return next
}

/** Running jobs outlived for at least the cap; a cap of 0 stops nothing. */
const due = (input: {
  readonly outlived: ReadonlyMap<string, number>
  readonly views: ReadonlyMap<string, JobView>
  readonly now: number
  readonly capMinutes: number
}): readonly JobView[] => {
  if (input.capMinutes <= 0) return []
  return [...input.outlived].flatMap(([jobId, since]) => {
    const view = input.views.get(jobId)
    return view !== undefined && view.status === 'running' && input.now - since >= input.capMinutes * MINUTE_MS ? [view] : []
  })
}

export const OutlivedModel = { observe, due }

export const backgroundJobsSettingsTag = Settings.Tag<BackgroundJobsSettings>(backgroundJobsSettings.namespace)

export interface ReapResult {
  readonly outlived: number
  readonly stopped: readonly string[]
}

/** Tracks live jobs whose turn ended, and stops the ones nobody read for the configured cap. */
export class OutlivedJobs extends Context.Service<
  OutlivedJobs,
  {
    /** When each live job was first seen outliving its turn, keyed by job id; refreshed on every read. */
    readonly current: Effect.Effect<ReadonlyMap<string, number>>
    readonly reap: Effect.Effect<ReapResult>
    /**
     * One element each time the set of outlived jobs changes. A turn ends without any job event, so the board learns
     * about it here, from whichever read (`current`, the observe loop or `reap`) noticed first.
     */
    readonly changes: Stream.Stream<void>
  }
>()('@dshfiles/background-jobs/OutlivedJobs') {
  static readonly layer = Layer.effect(
    OutlivedJobs,
    Effect.gen(function* () {
      const live = yield* LiveJobs
      const turns = yield* TurnActivity
      const settings = yield* backgroundJobsSettingsTag
      const tracked = yield* SubscriptionRef.make<ReadonlyMap<string, number>>(new Map())

      const current = Effect.gen(function* () {
        const state = yield* live.state
        const running = yield* turns.runningSessionIds
        if (Option.isNone(running)) return yield* SubscriptionRef.updateAndGet(tracked, () => new Map())
        const now = yield* Clock.currentTimeMillis
        return yield* SubscriptionRef.updateAndGet(tracked, previous =>
          observe({ previous, views: state.views.values(), runningSessionIds: running.value, now }),
        )
      })

      const changes = SubscriptionRef.changes(tracked).pipe(
        Stream.map(outlived => [...outlived.keys()].sort().join('\n')),
        Stream.changes,
        Stream.drop(1),
        Stream.as(undefined),
      )

      const reap = Effect.gen(function* () {
        const outlived = yield* current
        const state = yield* live.state
        const capMinutes = (yield* settings.get).stopOutlivedAfterMinutes
        const stopping = due({ outlived, views: state.views, now: yield* Clock.currentTimeMillis, capMinutes })
        if (Option.isNone(state.registry) || stopping.length === 0) return { outlived: outlived.size, stopped: [] }
        const registry = state.registry.value
        const reason = `stopped: outlived its turn for ${String(capMinutes)} min with no reader`
        const outcomes = yield* Effect.forEach(stopping, view =>
          Effect.try(() => registry.kill(JobId(view.id), view.owner === undefined ? undefined : SessionId(String(view.owner)), reason)).pipe(
            Effect.map(outcome => (outcome === 'requested' ? [view.id] : [])),
            Effect.catch(error => Effect.as(Effect.logWarning(`background-jobs: could not stop outlived job ${view.id}`, error), [])),
          ),
        )
        const stopped = outcomes.flat()
        yield* Effect.annotateCurrentSpan({ 'dshx.jobs.outlived': outlived.size, 'dshx.jobs.stopped': stopped.length, 'dshx.jobs.cap_minutes': capMinutes })
        return { outlived: outlived.size, stopped }
      }).pipe(Effect.withSpan('background-jobs reap', { attributes: { 'dshx.plugin.package': '@dshfiles/background-jobs' } }))

      return OutlivedJobs.of({ current, reap, changes })
    }),
  )
}
