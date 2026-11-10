import { randomUUID } from 'node:crypto'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session/types'
import { WorkspaceId, type Workspace } from '@deepseek-ai/dsh-workspace'
import { HostContext, hostService } from '@dshfiles/dshx/effect'
import { Cache, Clock, Context, Duration, Effect, Exit, Layer } from 'effect'
import { HostCallFailed } from './errors.js'
import { SETTLED_THREADS_NAMESPACE, parseSettledStatus } from './settle-cleanup.js'
import { SESSION_ACTIVITY_PROJECTIONS, ThreadRebaseEligibilityModel, type ThreadSessionActivity } from './thread-rebase-eligibility.js'

/**
 * The DSH Host services jj-integration reads, as Effect services. Each one is read at the call because the Host may
 * load it after this plugin; a missing service or a rejected call fails with `HostCallFailed`.
 */

type ActivityLevel = 'routine' | 'notable' | 'attention'

/**
 * The `workspace` payload this bundle emits on `dshfiles/activity/event`;
 * `@dshfiles/activity-timeline` decodes it into one Activity item.
 */
interface WorkspaceActivityEventPayload {
  readonly kind: 'workspace'
  readonly value: {
    readonly id: string
    readonly at: number
    readonly type: string
    readonly level: ActivityLevel
    readonly summary: string
    readonly detail: string | null
    readonly sessionId: string | null
    readonly correlationId: string | null
    readonly workspaceId: string | null
    readonly workspaceName: string | null
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshfiles/activity/event'(payload: WorkspaceActivityEventPayload): void
  }
}

const hostCall =
  (service: string, operation: string) =>
  (cause: unknown): HostCallFailed =>
    new HostCallFailed({ service, operation, cause })

const serviceOf = <K extends 'workspaceRegistry' | 'sessionController' | 'sessionPersistence' | 'sessionQuery' | 'agents' | 'settings'>(
  host: HostContext['Service'],
  name: K,
  label: string,
) => Effect.provideService(hostService(name), HostContext, host).pipe(Effect.mapError(hostCall(label, 'start')))

/** The DSH workspace registry: registered folders, their Sessions and the archived Sessions. */
export class WorkspaceRegistry extends Context.Service<
  WorkspaceRegistry,
  {
    readonly list: Effect.Effect<readonly Workspace[], HostCallFailed>
    readonly get: (workspaceId: string) => Effect.Effect<Workspace | undefined, HostCallFailed>
    readonly resolveByPath: (path: string) => Effect.Effect<Workspace | undefined, HostCallFailed>
    readonly create: (input: { readonly path: string; readonly title: string }) => Effect.Effect<Workspace, HostCallFailed>
    readonly remove: (workspaceId: string) => Effect.Effect<void, HostCallFailed>
    readonly archivedSessionIds: Effect.Effect<ReadonlySet<string>, HostCallFailed>
  }
>()('@dshfiles/jj-integration/WorkspaceRegistry') {
  static readonly layer = Layer.effect(
    WorkspaceRegistry,
    Effect.gen(function* () {
      const host = yield* HostContext
      const registry = serviceOf(host, 'workspaceRegistry', 'workspace registry')
      return WorkspaceRegistry.of({
        list: Effect.map(registry, found => found.list()),
        get: workspaceId => Effect.map(registry, found => found.get(WorkspaceId(workspaceId))),
        resolveByPath: Effect.fn('workspace registry resolve')(function* (path: string) {
          const found = yield* registry
          return yield* Effect.tryPromise({ try: () => found.resolveByPath(path), catch: hostCall('workspace registry', 'resolve a folder') })
        }),
        create: Effect.fn('workspace registry create')(function* (input: { readonly path: string; readonly title: string }) {
          const found = yield* registry
          return yield* Effect.tryPromise({ try: () => found.create(input.path, input.title), catch: hostCall('workspace registry', 'register a folder') })
        }),
        remove: Effect.fn('workspace registry remove')(function* (workspaceId: string) {
          const found = yield* registry
          yield* Effect.tryPromise({ try: () => found.delete(WorkspaceId(workspaceId)), catch: hostCall('workspace registry', 'remove a folder') })
        }),
        archivedSessionIds: Effect.map(registry, found => new Set<string>(found.archivedSessionIds)),
      })
    }),
  )
}

export type SessionActivityMap = ReadonlyMap<string, ThreadSessionActivity>

interface WorkspaceSessionProjections {
  readonly title?: string | null | undefined
  readonly userQuestions?: { readonly active: readonly unknown[] } | null | undefined
  readonly sessionListMetadata?: { readonly blank: boolean } | null | undefined
}

export interface SessionRecord {
  readonly id: string
  readonly cwd: string | undefined
}

/** A fork's boundary never moves, so one observation per forked Session serves every Turn tail of its conversation. */
const MAX_FORK_CUT_ENTRIES = 256

/** What jj-integration reads about Sessions: activity, projections, the fork boundary and every stored Session's folder. */
export class SessionReads extends Context.Service<
  SessionReads,
  {
    /** Every listed Session's activity, or `HostCallFailed` when the controller is missing or the list fails. */
    readonly listActivity: (sessionIds?: readonly string[]) => Effect.Effect<SessionActivityMap, HostCallFailed>
    /** One Session's projections; `null` when it is neither live nor stored. */
    readonly projections: (sessionId: string) => Effect.Effect<{ readonly values: WorkspaceSessionProjections } | null, HostCallFailed>
    readonly isRunning: (sessionId: string) => Effect.Effect<boolean>
    /**
     * A forked Session copies its parent's transcript but keeps working in the parent's jj workspace, so that workspace
     * keeps recording the parent's later lands. The fork's boundary is the last event it inherited, not its creation.
     */
    readonly forkCutAt: (sessionId: string) => Effect.Effect<number | undefined>
    readonly records: Effect.Effect<readonly SessionRecord[], HostCallFailed>
  }
>()('@dshfiles/jj-integration/SessionReads') {
  static readonly layer = Layer.effect(
    SessionReads,
    Effect.gen(function* () {
      const host = yield* HostContext
      const controller = serviceOf(host, 'sessionController', 'Session controller')
      const sessionQuery = serviceOf(host, 'sessionQuery', 'Session query')
      const persistence = serviceOf(host, 'sessionPersistence', 'Session store')
      const agents = serviceOf(host, 'agents', 'agent registry')

      const listActivity = Effect.fn('session activity list')(function* (sessionIds?: readonly string[]) {
        const found = yield* controller
        const result = yield* Effect.tryPromise({
          try: signal => found.list({ projections: SESSION_ACTIVITY_PROJECTIONS }, signal),
          catch: hostCall('Session controller', 'list Sessions'),
        })
        const wanted = sessionIds === undefined ? undefined : new Set(sessionIds)
        return new Map(
          result.items
            .filter(item => wanted === undefined || wanted.has(item.sessionId))
            .map((item): [string, ThreadSessionActivity] => [
              item.sessionId,
              {
                running: item.running,
                pendingUserQuestion: ThreadRebaseEligibilityModel.hasPendingUserQuestion(item.projections?.values),
                title: item.projections?.values.title ?? undefined,
                blank: item.blank,
              },
            ]),
        ) satisfies SessionActivityMap
      })

      const readForkCut = (sessionId: string) =>
        Effect.gen(function* () {
          const stat = yield* Effect.flatMap(persistence, store => Effect.tryPromise(() => store.stat(SessionId(sessionId))))
          if (stat?.header.isSeeded !== true) return undefined
          const query = yield* sessionQuery
          return yield* Effect.acquireUseRelease(
            Effect.tryPromise(() => query.observeSession(SessionId(sessionId), { projectionMode: 'none' })),
            observation => Effect.sync(() => observation.events[observation.inheritedEventCount - 1]?.time),
            observation => Effect.sync(() => observation[Symbol.dispose]()),
          )
        }).pipe(Effect.orElseSucceed(() => undefined))

      const forkCuts = yield* Cache.makeWith(readForkCut, {
        capacity: MAX_FORK_CUT_ENTRIES,
        timeToLive: exit => (Exit.isSuccess(exit) && exit.value !== undefined ? Duration.infinity : Duration.zero),
      })

      return SessionReads.of({
        listActivity,
        projections: Effect.fn('session projections read')(function* (sessionId: string) {
          const found = yield* controller
          return yield* Effect.tryPromise({
            try: signal => found.projections({ sessionId: SessionId(sessionId) }, signal),
            catch: hostCall('Session controller', 'read Session projections'),
          })
        }),
        isRunning: sessionId =>
          agents.pipe(
            Effect.map(registry => registry.get(SessionId(sessionId))?.status === 'running'),
            Effect.orElseSucceed(() => false),
          ),
        forkCutAt: sessionId => Cache.get(forkCuts, sessionId),
        records: Effect.gen(function* () {
          const query = yield* sessionQuery
          const listed = yield* Effect.tryPromise({ try: () => query.listSessions(), catch: hostCall('Session query', 'list stored Sessions') })
          return listed.map((record): SessionRecord => ({ id: String(record.header.id), cwd: record.header.cwd }))
        }).pipe(Effect.withSpan('session records list')),
      })
    }),
  )
}

const PROMPT_TIMEOUT = Duration.seconds(15)

/** Queues a message in a Session, as a user would. */
export class SessionPrompt extends Context.Service<
  SessionPrompt,
  { readonly queue: (input: { readonly sessionId: string; readonly text: string }) => Effect.Effect<void, HostCallFailed> }
>()('@dshfiles/jj-integration/SessionPrompt') {
  static readonly layer = Layer.effect(
    SessionPrompt,
    Effect.gen(function* () {
      const host = yield* HostContext
      const controller = serviceOf(host, 'sessionController', 'Session controller')
      return SessionPrompt.of({
        queue: Effect.fn('session prompt queue')(function* (input: { readonly sessionId: string; readonly text: string }) {
          const found = yield* controller
          // SAFETY: SessionRequestId is a type-only brand, so the unique id `randomUUID` mints is a valid one.
          const requestId = randomUUID() as SessionRequestId
          yield* Effect.tryPromise({
            try: signal =>
              found.prompt({ requestId, sessionId: SessionId(input.sessionId), mode: 'queue', content: [{ type: 'text', text: input.text }] }, signal),
            catch: hostCall('Session controller', 'queue a message'),
          }).pipe(
            Effect.timeoutOrElse({
              duration: PROMPT_TIMEOUT,
              orElse: () => Effect.fail(new HostCallFailed({ service: 'Session controller', operation: 'queue a message in time' })),
            }),
          )
        }),
      })
    }),
  )
}

export interface ActivityInput {
  readonly type: string
  readonly summary: string
  readonly detail?: string | undefined
  readonly path: string | null
  readonly sessionId?: string | null | undefined
  readonly correlationId?: string | undefined
  readonly level?: ActivityLevel | undefined
}

const basenameOf = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)

/** One workspace Activity item on the shared activity event; reporting never fails the work it reports on. */
export class ActivityLog extends Context.Service<ActivityLog, { readonly emit: (input: ActivityInput) => Effect.Effect<void> }>()(
  '@dshfiles/jj-integration/ActivityLog',
) {
  static readonly layer = Layer.effect(
    ActivityLog,
    Effect.gen(function* () {
      const host = yield* HostContext
      return ActivityLog.of({
        emit: input =>
          Effect.gen(function* () {
            const at = yield* Clock.currentTimeMillis
            const path = input.path === null || input.path.length === 0 ? null : input.path
            yield* Effect.try({
              try: () =>
                host.ctx.emit('dshfiles/activity/event', {
                  kind: 'workspace',
                  value: {
                    id: `workspace:${input.type}:${path ?? 'repository'}:${String(at)}`,
                    at,
                    type: input.type,
                    level: input.level ?? 'notable',
                    summary: input.summary,
                    detail: input.detail ?? null,
                    sessionId: input.sessionId ?? null,
                    correlationId: input.correlationId ?? null,
                    workspaceId: path,
                    workspaceName: path === null ? null : basenameOf(path),
                  },
                }),
              catch: hostCall('activity timeline', 'record an event'),
            })
          }).pipe(Effect.catch(error => Effect.logWarning('jj-integration: activity event dropped', error))),
      })
    }),
  )
}

/** The Session ids thread-sidebar records as settled, read from its settings document. */
export class SettledThreads extends Context.Service<SettledThreads, { readonly read: Effect.Effect<readonly string[] | undefined> }>()(
  '@dshfiles/jj-integration/SettledThreads',
) {
  static readonly namespace = SETTLED_THREADS_NAMESPACE

  static readonly layer = Layer.effect(
    SettledThreads,
    Effect.gen(function* () {
      const host = yield* HostContext
      const settings = serviceOf(host, 'settings', 'settings')
      return SettledThreads.of({
        read: settings.pipe(
          Effect.flatMap(forms =>
            Effect.try({
              try: () => parseSettledStatus(forms.describe().find(entry => entry.ns === SETTLED_THREADS_NAMESPACE)?.value).settledSessionIds,
              catch: hostCall('settings', 'read settled threads'),
            }),
          ),
          Effect.orElseSucceed(() => undefined),
        ),
      })
    }),
  )
}

export const HostEdgesLive = Layer.mergeAll(WorkspaceRegistry.layer, SessionReads.layer, SessionPrompt.layer, ActivityLog.layer, SettledThreads.layer)
