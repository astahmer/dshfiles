import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-jobs'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type {} from '@deepseek-ai/dsh-session-query'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { HostContext } from '@dshfiles/dshx/effect'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { Context, Effect, Layer, Option } from 'effect'
import type { RebasedThread } from './rebased-threads.js'
import { HostCallFailed, HostCapabilityMissing } from './sidebar-errors.js'

type SessionListItem = Awaited<ReturnType<CordisContext['sessionController']['list']>>['items'][number]

/** One Session as the sidebar's Host verbs read it. */
export interface HostSession {
  readonly sessionId: string
  readonly running: boolean
  readonly blank: boolean
  readonly updatedAt: number
  readonly parentSessionId: string | undefined
  readonly pendingQuestions: number
  readonly cwd: string | undefined
}

export interface HostWorkspace {
  readonly workspaceId: WorkspaceId
  readonly path: string
  readonly sessionIds: readonly SessionId[]
}

export type QueueAction = { readonly kind: 'remove' } | { readonly kind: 'steer' } | { readonly kind: 'edit'; readonly text: string }

const PROMPT_TIMEOUT = '15 seconds'

const hostSession = (item: SessionListItem): HostSession => ({
  sessionId: String(item.sessionId),
  running: item.running,
  blank: item.blank,
  updatedAt: item.updatedAt,
  parentSessionId: item.parentSessionId === undefined ? undefined : String(item.parentSessionId),
  pendingQuestions: item.projections?.values.userQuestions?.active.length ?? 0,
  cwd: item.cwd,
})

/**
 * The DSH Host services the sidebar reads and drives, typed as Effects: the live Agents, the Session controller, the
 * workspace registry, Session persistence and the process exit hook. The only holder of the Cordis services here.
 */
export class SidebarHost extends Context.Service<
  SidebarHost,
  {
    readonly runningSessionIds: Effect.Effect<ReadonlyArray<string>>
    readonly sessions: Effect.Effect<ReadonlyArray<HostSession>, HostCallFailed>
    readonly workspaces: Effect.Effect<ReadonlyArray<HostWorkspace>>
    readonly archivedSessionIds: Effect.Effect<ReadonlyArray<string>>
    readonly pinnedSessionIds: Effect.Effect<ReadonlyArray<string>>
    readonly flushPersistence: Effect.Effect<void, HostCapabilityMissing | HostCallFailed>
    readonly queuePrompt: (input: {
      readonly requestId: string
      readonly sessionId: string
      readonly text: string
    }) => Effect.Effect<void, HostCapabilityMissing | HostCallFailed>
    readonly updateQueue: (input: {
      readonly sessionId: string
      readonly itemId: string
      readonly action: QueueAction
    }) => Effect.Effect<void, HostCapabilityMissing | HostCallFailed>
    /** jj-integration's thread workspaces, or none when it is not installed. */
    readonly rebasedThreads: Effect.Effect<Option.Option<ReadonlyArray<RebasedThread>>, HostCallFailed>
    /** The DSH process exit hook, present only where DSH may exit on a plugin's request. */
    readonly appExit: Option.Option<(code: number) => void>
    /** Stop every running job these Sessions own, through the job registry's owner fence; answers the ids stopped. */
    readonly stopJobs: (input: { readonly sessionIds: ReadonlyArray<string>; readonly reason: string }) => Effect.Effect<ReadonlyArray<string>>
  }
>()('@dshfiles/thread-sidebar/SidebarHost') {
  static readonly layer = Layer.effect(
    SidebarHost,
    Effect.gen(function* () {
      const host = yield* HostContext
      const ctx = host.ctx
      const jj = createHostApiClient(ctx, jjIntegrationApi, host.packageId)
      const call = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
        Effect.tryPromise({ try: run, catch: cause => new HostCallFailed({ operation, cause }) })
      const controller = Effect.suspend(() => {
        const service = ctx.get('sessionController')
        return service === undefined ? Effect.fail(new HostCapabilityMissing({ capability: 'session-controller' })) : Effect.succeed(service)
      })
      return SidebarHost.of({
        runningSessionIds: Effect.sync(() => [
          ...new Set(
            ctx.agents
              .list()
              .filter(agent => agent.status === 'running')
              .map(agent => String(agent.id)),
          ),
        ]),
        sessions: call('list sessions', signal => ctx.sessionController.list({}, signal)).pipe(
          Effect.map(listed => listed.items.map(hostSession)),
          Effect.withSpan('host sessions list'),
        ),
        workspaces: Effect.sync(() =>
          ctx.workspaceRegistry.list().map(workspace => ({ workspaceId: workspace.id, path: workspace.path, sessionIds: [...workspace.sessionIds] })),
        ),
        archivedSessionIds: Effect.sync(() => [...ctx.workspaceRegistry.archivedSessionIds]),
        pinnedSessionIds: Effect.sync(() => [...ctx.workspaceRegistry.pinnedSessionIds]),
        flushPersistence: Effect.suspend((): Effect.Effect<void, HostCapabilityMissing | HostCallFailed> => {
          const persistence = ctx.get('sessionPersistence')
          if (persistence === undefined) return Effect.fail(new HostCapabilityMissing({ capability: 'session-persistence' }))
          return call('flush session persistence', () => persistence.flush())
        }).pipe(Effect.withSpan('host persistence flush')),
        queuePrompt: Effect.fn('host prompt queue')(function* (input) {
          const service = yield* controller
          yield* call('queue the resume prompt', signal =>
            service.prompt(
              {
                // SAFETY: the recovery file's schema validated this request id as a UUID before it was branded here.
                requestId: input.requestId as SessionRequestId,
                sessionId: SessionId(input.sessionId),
                mode: 'queue',
                content: [{ type: 'text', text: input.text }],
              },
              signal,
            ),
          ).pipe(
            Effect.timeoutOrElse({ duration: PROMPT_TIMEOUT, orElse: () => Effect.fail(new HostCallFailed({ operation: 'queue the resume prompt in time' })) }),
          )
        }),
        updateQueue: Effect.fn('host queue update')(function* (input) {
          const service = yield* controller
          const action = input.action.kind === 'edit' ? { kind: 'edit' as const, content: [{ type: 'text' as const, text: input.action.text }] } : input.action
          yield* call('change the queued message', () =>
            service.updateQueue({ sessionId: SessionId(input.sessionId), itemId: MessageId(input.itemId), action }),
          )
        }),
        rebasedThreads: call('read jj thread workspaces', () => jj.repositories({})).pipe(
          Effect.map((view): Option.Option<ReadonlyArray<RebasedThread>> => Option.some(view.repositories.flatMap(repository => repository.threads))),
          Effect.catchTag('HostCallFailed', error =>
            error.cause instanceof Error && isApiOwnerMissing(error.cause) ? Effect.succeed(Option.none()) : Effect.fail(error),
          ),
          Effect.withSpan('host jj threads read'),
        ),
        appExit: Option.fromNullishOr(ctx.appExit),
        stopJobs: Effect.fn('host jobs stop')(function* (input) {
          const jobs = ctx.get('jobs')
          if (jobs === undefined || jobs === null) return []
          const owned = input.sessionIds.flatMap(sessionId =>
            jobs
              .list(SessionId(sessionId))
              .filter(job => job.owner === sessionId && job.status === 'running')
              .map(job => ({ sessionId, jobId: job.id })),
          )
          const stopped = yield* Effect.forEach(owned, job =>
            Effect.try(() => jobs.kill(job.jobId, SessionId(job.sessionId), input.reason)).pipe(
              Effect.map(outcome => (outcome === 'requested' ? [String(job.jobId)] : [])),
              Effect.catch(error => Effect.as(Effect.logWarning(`thread-sidebar: could not stop job ${job.jobId}`, error), [])),
            ),
          )
          return stopped.flat()
        }),
      })
    }),
  )
}
