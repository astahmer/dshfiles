import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type { JobEvent, JobView } from '@deepseek-ai/dsh-jobs'
import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-workspace'
import { DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { Context, Duration, Effect, Layer, Option, Queue, Ref, Schema } from 'effect'
import type { KnownSession, KnownWorkspace, LiveJob } from './process-table.js'

const SESSIONS_TIMEOUT = Duration.millis(2_500)
const STOP_REASON = 'stopped from the worktree memory panel'

const listedTitleSchema = Schema.String.check(Schema.isMinLength(1))
const listedCreationSchema = Schema.Struct({ createdAt: Schema.optional(Schema.Number) })

/** The Sessions and workspaces the Host knows, read through its controllers. */
export class HostDirectory extends Context.Service<
  HostDirectory,
  {
    /** `undefined` when the Session controller is missing or its list failed. */
    readonly sessions: Effect.Effect<readonly KnownSession[] | undefined>
    readonly workspaces: Effect.Effect<readonly KnownWorkspace[]>
  }
>()('@dshfiles/worktree-memory/HostDirectory') {
  static readonly layer = Layer.effect(
    HostDirectory,
    Effect.gen(function* () {
      const host = yield* HostContext
      const sessions = Effect.gen(function* () {
        const controller = host.ctx.get('sessionController')
        if (controller === undefined) return undefined
        const listed = yield* Effect.tryPromise(signal => controller.list({}, signal)).pipe(Effect.timeout(SESSIONS_TIMEOUT), Effect.option)
        if (Option.isNone(listed)) return undefined
        return listed.value.items.map(summary => ({
          sessionId: summary.sessionId,
          cwd: summary.cwd ?? null,
          createdAt: Option.getOrNull(Schema.decodeUnknownOption(listedCreationSchema)(summary))?.createdAt ?? null,
          running: summary.running,
          updatedAt: summary.updatedAt ?? null,
          // The list serves each title from its cached projections; the per-Session title read decoded whole logs.
          title: Option.getOrNull(Schema.decodeUnknownOption(listedTitleSchema)(summary.projections?.values.title)) ?? null,
        }))
      })
      const workspaces = Effect.sync(() =>
        (host.ctx.get('workspaceRegistry')?.list() ?? []).map(workspace => ({ path: workspace.path, title: workspace.title })),
      )
      return HostDirectory.of({ sessions, workspaces })
    }),
  )
}

interface JobRegistry {
  readonly events: { subscribe(filter: { readonly owners: 'all' }, listener: (event: JobEvent) => void): () => void }
  kill(id: JobId, caller?: SessionId, reason?: string): 'requested' | 'already-finished'
}

type JobUpdate =
  | { readonly _tag: 'attached'; readonly registry: JobRegistry }
  | { readonly _tag: 'detached' }
  | { readonly _tag: 'event'; readonly event: JobEvent }

/** The Host job registry while it is loaded: every live job, and a kill through the registry that owns it. */
export class JobTracker extends Context.Service<
  JobTracker,
  {
    readonly running: Effect.Effect<readonly LiveJob[]>
    /** Ask the registry to stop a job; `false` when no registry is loaded. */
    readonly kill: (input: { readonly jobId: string; readonly sessionId: string | null }) => Effect.Effect<boolean>
  }
>()('@dshfiles/worktree-memory/JobTracker') {
  static readonly layer = Layer.effect(
    JobTracker,
    Effect.gen(function* () {
      const host = yield* HostContext
      const jobs = yield* Ref.make<ReadonlyMap<string, JobView>>(new Map())
      const registry = yield* Ref.make(Option.none<JobRegistry>())
      const updates = yield* Queue.unbounded<JobUpdate>()

      const apply = (update: JobUpdate) => {
        if (update._tag === 'attached') return Ref.set(registry, Option.some(update.registry))
        if (update._tag === 'detached') return Effect.andThen(Ref.set(registry, Option.none()), Ref.set(jobs, new Map()))
        const event = update.event
        if (event.type === 'output') return Effect.void
        return Ref.update(jobs, current => {
          const next = new Map(current)
          if (event.type === 'removed') next.delete(event.job.id)
          else next.set(event.job.id, event.job)
          return next
        })
      }
      yield* DshxPlugin.worker(Queue.take(updates).pipe(Effect.flatMap(apply), Effect.forever))

      yield* Effect.acquireRelease(
        Effect.sync(() =>
          host.ctx.inject(['jobs'], scoped => {
            const loaded = scoped.get('jobs')
            if (loaded === undefined) return
            scoped.effect(() => {
              Queue.offerUnsafe(updates, { _tag: 'attached', registry: loaded })
              const unsubscribe = loaded.events.subscribe({ owners: 'all' }, event => Queue.offerUnsafe(updates, { _tag: 'event', event }))
              return () => {
                unsubscribe()
                Queue.offerUnsafe(updates, { _tag: 'detached' })
              }
            }, 'worktree-memory: live job tracking')
          }),
        ),
        tracking => Effect.sync(() => tracking.dispose()),
      )

      const running = Effect.map(Ref.get(jobs), current =>
        [...current.values()]
          .filter(job => job.status === 'running' || job.status === 'stopping')
          .map(job => ({ id: job.id, label: job.label, owner: job.owner ?? null, startedAt: job.startedAt })),
      )

      const kill = Effect.fn('worktree-memory job kill')(function* (input: { readonly jobId: string; readonly sessionId: string | null }) {
        const loaded = yield* Ref.get(registry)
        if (Option.isNone(loaded)) return false
        yield* Effect.sync(() => loaded.value.kill(JobId(input.jobId), input.sessionId === null ? undefined : SessionId(input.sessionId), STOP_REASON))
        return true
      })

      return JobTracker.of({ running, kill })
    }),
  )
}
