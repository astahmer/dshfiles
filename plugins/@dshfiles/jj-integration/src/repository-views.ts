import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { Cache, Clock, Context, Duration, Effect, Exit, Fiber, FiberSet, FileSystem, Layer, Option, Path, SynchronizedRef } from 'effect'
import type { RepositoryView, ThreadView } from './api.js'
import type { HostCallFailed, ThreadWorkspaceError } from './errors.js'
import { SessionReads, WorkspaceRegistry, type SessionActivityMap } from './host-edges-promise.js'
import { IntegrationAttribution } from './integration-attribution.js'
import { IntegrationRequests, IsolatedSessions } from './integration-requests.js'
import { SessionActivity } from './session-activity.js'
import { ThreadIntegrationModel } from './thread-integration-state.js'
import { ThreadRebaseEligibilityModel } from './thread-rebase-eligibility.js'
import { ThreadWorkspaces, type ThreadStatus } from './thread-workspaces.js'
import type { ThreadLocation } from './thread-workspace-model.js'

/**
 * A repository scan costs one `jj` process per workspace and two more per thread, while the New thread screen and the
 * sidebar ask for it. Every layer is cached and every scan is single-flight: a poll storm shares one scan instead of
 * pinning one browser connection per caller, and a mutation is the only thing that reads them all again. A registered
 * folder's repository and workspace identity never change, so it outlives the statuses that do.
 */
const LOCATION_TTL = Duration.minutes(30)
const THREAD_STATUS_TTL = Duration.seconds(30)
const REPOSITORY_VIEW_TTL_MS = 60_000
/** One `jj workspace list` plus two revsets per thread, so repositories are scanned a bounded few at a time. */
const REPOSITORY_SCAN_CONCURRENCY = 4
/** One `jj` process each, and the scan runs while the user is working. */
const LOCATE_CONCURRENCY = 8
const MAX_LOCATIONS = 4_096
const MAX_STATUS_REPOSITORIES = 256

export interface ThreadCaller {
  readonly fromAgent: boolean
  readonly sessionId: string | undefined
}

export interface LocatedWorkspace {
  readonly workspace: Workspace
  readonly location: Option.Option<ThreadLocation>
}

export type ScanError = HostCallFailed | ThreadWorkspaceError

export interface RepositoriesSnapshot {
  readonly repositories: RepositoryView[]
  readonly refreshing: boolean
  readonly refreshFailed: boolean
}

interface ViewsState {
  readonly cached: { readonly value: readonly RepositoryView[]; readonly at: number } | undefined
  readonly invalidated: boolean
  readonly failedAt: number | undefined
  readonly generation: number
  readonly scan: Fiber.Fiber<readonly RepositoryView[], ScanError> | undefined
}

interface ScanStart {
  readonly started: boolean
  readonly fiber: Fiber.Fiber<readonly RepositoryView[], ScanError>
}

export class RepositoryViews extends Context.Service<
  RepositoryViews,
  {
    /** The repository a registered folder belongs to; a folder outside jj is a cached miss. */
    readonly location: (path: string) => Effect.Effect<Option.Option<ThreadLocation>, ThreadWorkspaceError>
    readonly bestEffortLocation: (path: string) => Effect.Effect<Option.Option<ThreadLocation>>
    readonly forgetLocation: (path: string) => Effect.Effect<void>
    /** Registered workspaces whose folders still exist, each with its repository. */
    readonly locatedWorkspaces: Effect.Effect<readonly LocatedWorkspace[], HostCallFailed>
    /** The last scan, refreshing in the background when it is stale. */
    readonly snapshot: Effect.Effect<RepositoriesSnapshot>
    /** Start a scan; false when one is already running. */
    readonly startRefresh: Effect.Effect<boolean>
    /** A fresh scan, shared with any scan already running. */
    readonly list: Effect.Effect<readonly RepositoryView[], ScanError>
    /** Forget the assembled views only, e.g. after a change to queued integrations. */
    readonly invalidateViews: Effect.Effect<void>
    /** Forget views, thread statuses and the Session activity they were judged on, after a jj mutation. */
    readonly invalidate: Effect.Effect<void>
    readonly threadView: (input: {
      readonly status: ThreadStatus
      readonly workspace: Workspace | undefined
      readonly archived: ReadonlySet<string>
      readonly activity: SessionActivityMap | undefined
      readonly caller?: ThreadCaller | undefined
      readonly viewer?: { readonly sessionId: string; readonly forkCutAt: number | undefined } | undefined
    }) => Effect.Effect<ThreadView>
    /** The thread at a located workspace, or undefined when it is not a thread. */
    readonly findThread: (input: {
      readonly location: ThreadLocation
      readonly includeActivity?: boolean | undefined
      /** The Session asking, so its own turn is not counted against the thread it wants to rebase. */
      readonly caller?: ThreadCaller | undefined
      /** The Session reading the view, so integration notices show only the lands its conversation knows about. */
      readonly viewerSessionId?: string | undefined
    }) => Effect.Effect<{ readonly repoRoot: string; readonly thread: ThreadView } | undefined, ScanError>
  }
>()('@dshfiles/jj-integration/RepositoryViews') {
  static readonly layer = Layer.effect(
    RepositoryViews,
    Effect.gen(function* () {
      const threads = yield* ThreadWorkspaces
      const registry = yield* WorkspaceRegistry
      const sessions = yield* SessionReads
      const activity = yield* SessionActivity
      const requests = yield* IntegrationRequests
      const isolated = yield* IsolatedSessions
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const scans = yield* FiberSet.make<readonly RepositoryView[], ScanError>()

      /**
       * A registered workspace's location never moves, and most registered folders are not jj repositories at all:
       * caching the misses too keeps a store with dozens of workspaces from paying one `jj` process each per scan.
       */
      const locations = yield* Cache.makeWith(
        (target: string) =>
          threads.locate(target).pipe(
            Effect.map(Option.some),
            Effect.catchTag('NotARepository', () => Effect.succeed(Option.none<ThreadLocation>())),
          ),
        { capacity: MAX_LOCATIONS, timeToLive: exit => (Exit.isSuccess(exit) ? LOCATION_TTL : Duration.zero) },
      )
      const statuses = yield* Cache.make({
        lookup: (repoRoot: string) => threads.list(repoRoot),
        capacity: MAX_STATUS_REPOSITORIES,
        timeToLive: THREAD_STATUS_TTL,
      })

      const location = (target: string) => Cache.get(locations, target)
      const bestEffortLocation = (target: string) => location(target).pipe(Effect.orElseSucceed(() => Option.none<ThreadLocation>()))

      const locatedWorkspaces = Effect.gen(function* () {
        const workspaces = yield* registry.list
        const present = yield* Effect.filter(workspaces, workspace => fileSystem.exists(workspace.path).pipe(Effect.orElseSucceed(() => false)), {
          concurrency: LOCATE_CONCURRENCY,
        })
        return yield* Effect.forEach(
          present,
          workspace => Effect.map(bestEffortLocation(workspace.path), (found): LocatedWorkspace => ({ workspace, location: found })),
          {
            concurrency: LOCATE_CONCURRENCY,
          },
        )
      })

      const threadView = Effect.fn('repository views thread view')(function* (input: Parameters<RepositoryViews['Service']['threadView']>[0]) {
        const status = input.status
        const sessionIds = [...new Set([...(input.workspace?.sessionIds ?? []), ...(yield* isolated.sessionIdsAt(status.path))])]
        const blankSessionIds = new Set(sessionIds.filter(sessionId => input.activity?.get(sessionId)?.blank === true))
        const caller = input.caller ?? { fromAgent: false, sessionId: undefined }
        const canRebase = ThreadRebaseEligibilityModel.eligibility({
          sessionIds,
          activity: input.activity,
          fromAgent: caller.fromAgent,
          sessionId: caller.sessionId,
        })
        const viewerSessionId = input.viewer?.sessionId
        const forkCutAt = input.viewer?.forkCutAt
        const view: ThreadView = {
          name: status.name,
          path: status.path,
          workspaceId: input.workspace?.id ?? null,
          sessionIds,
          finished: ThreadIntegrationModel.isFinishedThread(sessionIds, input.archived, blankSessionIds),
          missing: status.missing,
          behind: status.behind,
          behindCount: status.behindCount,
          unlanded: [...status.unlanded],
        }
        const withWorkspaceTitle: ThreadView = input.workspace === undefined ? view : { ...view, workspaceTitle: input.workspace.title }
        const withEligibility: ThreadView = canRebase === undefined ? withWorkspaceTitle : { ...withWorkspaceTitle, canRebase }
        const visible = IntegrationAttribution.forSession({ records: yield* requests.history(status.path), sessionId: viewerSessionId, forkCutAt })
        const queuedEntry = yield* requests.get(status.path)
        const integrationQueuedAt =
          queuedEntry !== undefined && (viewerSessionId === undefined || queuedEntry.sessionId === undefined || queuedEntry.sessionId === viewerSessionId)
            ? queuedEntry.queuedAt
            : undefined
        const withQueueEvents: ThreadView = { ...withEligibility, integrationQueueEvents: visible.map(event => ({ at: event.at, kind: event.kind })) }
        const withQueue: ThreadView = integrationQueuedAt === undefined ? withQueueEvents : { ...withQueueEvents, integrationQueuedAt }
        if (status.rebasedAt === undefined) return withQueue
        const integrations = IntegrationAttribution.forSession({ records: status.integrations ?? [], sessionId: viewerSessionId, forkCutAt }).map(record =>
          record.tipChangeId === undefined ? { at: record.at } : { at: record.at, tipChangeId: record.tipChangeId },
        )
        const viewWithRebaseTimestamp = { ...withQueue, rebasedAt: status.rebasedAt, integrations }
        if (status.rebasedTipChangeId === undefined) return viewWithRebaseTimestamp
        return { ...viewWithRebaseTimestamp, rebasedTipChangeId: status.rebasedTipChangeId }
      })

      /** Every registered project that is the owning checkout of a jj repository, with its thread workspaces. */
      const scanRepositories = Effect.gen(function* () {
        const workspaces = yield* registry.list
        const byPath = new Map(workspaces.map(workspace => [workspace.path, workspace]))
        const archived = yield* registry.archivedSessionIds
        const currentActivity = yield* activity.display
        const located = yield* locatedWorkspaces
        const repoRoots = [...new Set(located.flatMap(entry => (Option.isSome(entry.location) ? [entry.location.value.repoRoot] : [])))]
        const repositories = yield* Effect.forEach(
          repoRoots,
          repoRoot =>
            Effect.gen(function* () {
              const threadStatuses = yield* Cache.get(statuses, repoRoot)
              const bookmarks = yield* threads.bookmarks(repoRoot)
              const owner = byPath.get(repoRoot)
              return {
                repoRoot,
                title: owner?.title ?? path.basename(repoRoot),
                workspaceId: owner?.id ?? null,
                bookmarks: [...bookmarks.names],
                threads: yield* Effect.forEach(threadStatuses, status =>
                  threadView({ status, workspace: byPath.get(status.path), archived, activity: currentActivity }),
                ),
              } satisfies RepositoryView
            }),
          { concurrency: REPOSITORY_SCAN_CONCURRENCY },
        )
        return repositories
      }).pipe(Effect.withSpan('repository views scan'))

      const views = yield* SynchronizedRef.make<ViewsState>({ cached: undefined, invalidated: false, failedAt: undefined, generation: 0, scan: undefined })

      // Check and fork under the ref's lock, so callers that arrive together share one scan.
      const startScan = SynchronizedRef.modifyEffect(views, (current): Effect.Effect<readonly [ScanStart, ViewsState]> => {
        if (current.scan !== undefined) return Effect.succeed([{ started: false, fiber: current.scan }, current])
        const scanGeneration = current.generation
        const settle = (exit: Exit.Exit<readonly RepositoryView[], ScanError>) =>
          Effect.flatMap(Clock.currentTimeMillis, now =>
            SynchronizedRef.update(views, state => {
              const released = { ...state, scan: state.generation === scanGeneration ? undefined : state.scan }
              if (state.generation !== scanGeneration) return released
              if (Exit.isSuccess(exit)) return { ...released, cached: { value: exit.value, at: now }, invalidated: false, failedAt: undefined }
              return { ...released, failedAt: now }
            }),
          )
        return Effect.map(FiberSet.run(scans, scanRepositories.pipe(Effect.onExit(settle))), (fiber): readonly [ScanStart, ViewsState] => [
          { started: true, fiber },
          { ...current, scan: fiber, failedAt: undefined },
        ])
      })

      const snapshot = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const current = yield* SynchronizedRef.get(views)
        const value = [...(current.cached?.value ?? [])]
        const recentFailure = current.failedAt !== undefined && now - current.failedAt < REPOSITORY_VIEW_TTL_MS
        if (current.scan !== undefined) return { repositories: value, refreshing: true, refreshFailed: false }
        if (!current.invalidated && current.cached !== undefined && now - current.cached.at < REPOSITORY_VIEW_TTL_MS)
          return { repositories: value, refreshing: false, refreshFailed: recentFailure }
        if (recentFailure) return { repositories: value, refreshing: false, refreshFailed: true }
        yield* startScan
        return { repositories: value, refreshing: true, refreshFailed: false }
      })

      const invalidateViews = SynchronizedRef.update(views, state => ({
        ...state,
        generation: state.generation + 1,
        invalidated: true,
        scan: undefined,
        failedAt: undefined,
      }))

      return RepositoryViews.of({
        location,
        bestEffortLocation,
        forgetLocation: target => Cache.invalidate(locations, target),
        locatedWorkspaces,
        snapshot,
        startRefresh: Effect.map(startScan, started => started.started),
        list: Effect.flatMap(startScan, started => Fiber.join(started.fiber)),
        invalidateViews,
        invalidate: Effect.all([invalidateViews, Cache.invalidateAll(statuses), activity.reset], { discard: true }),
        threadView,
        findThread: Effect.fn('repository views find thread')(function* (input: Parameters<RepositoryViews['Service']['findThread']>[0]) {
          const threadName = input.location.threadName
          if (threadName === undefined) return undefined
          const workspace = yield* registry.resolveByPath(input.location.workspaceRoot)
          const shouldReadActivity = input.includeActivity !== false && workspace !== undefined && workspace.sessionIds.length > 0
          const viewerSessionId = input.viewerSessionId
          const [status, currentActivity, forkCutAt] = yield* Effect.all(
            [
              threads.status(input.location.repoRoot, threadName),
              shouldReadActivity ? activity.display : Effect.succeed(undefined),
              viewerSessionId === undefined ? Effect.succeed(undefined) : sessions.forkCutAt(viewerSessionId),
            ],
            { concurrency: 'unbounded' },
          )
          return {
            repoRoot: input.location.repoRoot,
            thread: yield* threadView({
              status,
              workspace,
              archived: yield* registry.archivedSessionIds,
              activity: currentActivity,
              caller: input.caller,
              viewer: viewerSessionId === undefined ? undefined : { sessionId: viewerSessionId, forkCutAt },
            }),
          }
        }),
      })
    }),
  )
}
