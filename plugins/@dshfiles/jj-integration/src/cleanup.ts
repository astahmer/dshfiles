import { randomUUID } from 'node:crypto'
import { Clock, Context, Effect, FileSystem, Layer, Option, Path } from 'effect'
import type { CleanupKindView, CleanupResult, CleanupTarget } from './api.js'
import { CleanupJobModel, type CleanupJobRequest, type CleanupJobView, type CleanupTrigger } from './cleanup-jobs.js'
import { CleanupOwnership } from './cleanup-ownership.js'
import { CleanupRunner, type CleanupReporter } from './cleanup-runner.js'
import { filterCleanupTargets } from './cleanup-targets.js'
import { ActivityLog, SessionReads, WorkspaceRegistry } from './host-edges-promise.js'
import { IntegrationRequests, IsolatedSessions } from './integration-requests.js'
import { JjSettings } from './jj-settings.js'
import { RepositoryViews } from './repository-views.js'
import { SessionActivity } from './session-activity.js'
import { ThreadWorkspaces } from './thread-workspaces.js'
import { WorkspaceCleanupModel } from './workspace-cleanup.js'
import { WorkspaceSessionPath } from './workspace-session-path.js'
import { WorkspaceSync } from './workspace-sync.js'

const HOUR_MS = 60 * 60_000
const BOOKMARK_READ_CONCURRENCY = 4
/** `cleanupWorkspaceSchema.message` in api.ts. */
const MAX_ROW_MESSAGE = 400

type PlannedWorkspace = Omit<CleanupResult['workspaces'][number], 'outcome' | 'message'>
type PlannedUntracked = Omit<CleanupResult['untracked'][number], 'outcome' | 'message'>

export interface CleanupRequest {
  readonly path?: string | undefined
  readonly olderThanHours: number
  readonly kinds: readonly CleanupKindView[]
  readonly targets?: readonly CleanupTarget[] | undefined
}

/** What one scan decided, before anything is removed: the removal pass reports its progress item by item. */
interface CleanupScan {
  readonly scopedRepoRoot: string | undefined
  readonly repoRoots: readonly string[]
  readonly skipped: CleanupResult['skipped']
  readonly workspaces: readonly PlannedWorkspace[]
  readonly workspaceIds: ReadonlyMap<string, string | null>
  readonly untracked: readonly PlannedUntracked[]
  /** Preview only: what the abandon pass would clear, read before anything moved. */
  readonly emptyRevisions: CleanupResult['emptyRevisions']
}

const make = Effect.gen(function* () {
  const threads = yield* ThreadWorkspaces
  const views = yield* RepositoryViews
  const registry = yield* WorkspaceRegistry
  const sessions = yield* SessionReads
  const activity = yield* SessionActivity
  const requests = yield* IntegrationRequests
  const isolated = yield* IsolatedSessions
  const settings = yield* JjSettings
  const sync = yield* WorkspaceSync
  const log = yield* ActivityLog
  const path = yield* Path.Path
  const fileSystem = yield* FileSystem.FileSystem

  const warnAndSkip = (what: string, repoRoot: string) => (error: { readonly message: string }) =>
    Effect.as(Effect.logWarning(`jj-integration: could not ${what} in ${repoRoot}: ${error.message}`), [])

  /** Which bookmarks hold each workspace's unlanded work; a read that fails names none, so the workspace is kept. */
  const bookmarkedWork = Effect.fnUntraced(function* (input: {
    readonly repoRoot: string
    readonly threads: readonly { readonly name: string; readonly unlanded: readonly unknown[] }[]
    readonly trigger: CleanupTrigger
    readonly kinds: readonly CleanupKindView[]
  }) {
    const found = new Map<string, readonly string[]>()
    if (!WorkspaceCleanupModel.readsBookmarkedWork(input)) return found
    yield* Effect.forEach(
      input.threads.filter(thread => thread.unlanded.length > 0),
      thread =>
        threads.containingBookmarks({ repoRoot: input.repoRoot, name: thread.name }).pipe(
          Effect.catch(warnAndSkip(`read the bookmarks holding ${thread.name}`, input.repoRoot)),
          Effect.map(bookmarks => found.set(thread.name, bookmarks)),
        ),
      { concurrency: BOOKMARK_READ_CONCURRENCY, discard: true },
    )
    return found
  })

  /**
   * The repository that owns `target`: the last scan as cached (it never starts one, since the panel polls this, and it
   * still knows a thread workspace whose folder is gone), then the cached location, then the jobs that already tied it
   * to a project (a workspace cleanup half-removed). Null when nothing traces it, e.g. a folder outside every repository.
   */
  const owningRepository = Effect.fn('cleanup owner resolve')(function* (
    target: string | null | undefined,
    recorded: Effect.Effect<readonly CleanupJobView[]>,
  ) {
    if (target === null || target === undefined) return null
    const known = CleanupOwnership.owner({ path, repositories: yield* views.cached, target })
    if (known !== null) return known
    const located = yield* views.bestEffortLocation(target)
    if (Option.isSome(located)) return located.value.repoRoot
    return CleanupOwnership.ownerFromJobs({ path, jobs: yield* recorded, target })
  })

  const scan = Effect.fn('cleanup scan')(function* (
    input: CleanupRequest & { readonly apply: boolean; readonly trigger: CleanupTrigger; readonly report?: CleanupReporter | undefined },
  ) {
    const kinds = input.trigger === 'automatic' ? input.kinds.filter(kind => kind !== 'secondary') : input.kinds
    const requested = input.path
    // A thread workspace whose folder is gone cannot locate itself, but its project still can be cleaned.
    const scopedRepoRoot =
      requested === undefined
        ? undefined
        : yield* threads.locate(requested).pipe(
            Effect.map(location => location.repoRoot),
            Effect.catch(error =>
              Effect.flatMap(owningRepository(requested, Effect.succeed([])), owner => (owner === null ? Effect.fail(error) : Effect.succeed(owner))),
            ),
          )
    if (scopedRepoRoot !== undefined && input.report !== undefined) yield* input.report.scoped(scopedRepoRoot)
    yield* views.invalidate
    const [registeredRepositories, currentActivity, sessionRecords] = yield* Effect.all(
      [
        views.list,
        input.apply ? activity.guard() : activity.display,
        kinds.includes('secondary') ? sessions.records.pipe(Effect.option, Effect.map(Option.getOrUndefined)) : Effect.succeed([]),
      ],
      { concurrency: 'unbounded' },
    )
    const repositories =
      scopedRepoRoot === undefined
        ? registeredRepositories
        : [
            registeredRepositories.find(repository => repository.repoRoot === scopedRepoRoot) ?? {
              repoRoot: scopedRepoRoot,
              title: path.basename(scopedRepoRoot),
              workspaceId: null,
              threads: [],
            },
          ]
    const archived = yield* registry.archivedSessionIds
    const now = yield* Clock.currentTimeMillis
    const olderThanMs = input.olderThanHours * HOUR_MS
    const repoRoots: string[] = []
    const workspaces: PlannedWorkspace[] = []
    const workspaceIds = new Map<string, string | null>()
    const skipped: CleanupResult['skipped'][number][] = []
    const emptyRevisions: CleanupResult['emptyRevisions'][number][] = []
    const untracked: PlannedUntracked[] = []
    // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- repositories are scanned one at a time so a cleanup never holds several repository locks.
    for (const repository of repositories) {
      repoRoots.push(repository.repoRoot)
      const changedAt = yield* threads.workingCopyChangedAt(repository.repoRoot).pipe(Effect.orElseSucceed(() => new Map<string, number>()))
      const integratedInto = yield* bookmarkedWork({ repoRoot: repository.repoRoot, threads: repository.threads, trigger: input.trigger, kinds })
      // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- each decision reads in-memory registry and queue state; there is no jj work to batch.
      for (const thread of repository.threads) {
        workspaceIds.set(thread.path, thread.workspaceId)
        const createdAt = thread.workspaceId === null ? undefined : (yield* registry.get(thread.workspaceId))?.createdAt
        const bookmarks = integratedInto.get(thread.name) ?? []
        const decision = WorkspaceCleanupModel.decide({
          thread: {
            name: thread.name,
            unlandedCount: thread.unlanded.length,
            integratedInto: bookmarks,
            rebasedAt: thread.rebasedAt,
            sessionIds: thread.sessionIds,
            integrationQueued: (yield* requests.get(thread.path)) !== undefined,
            usedAt: [changedAt.get(thread.name), thread.rebasedAt, createdAt === undefined ? undefined : Date.parse(createdAt)],
          },
          archived,
          activity: currentActivity,
          now,
          olderThanMs,
          kinds,
        })
        if (decision.action === 'skip') {
          skipped.push({ repoRoot: repository.repoRoot, name: thread.name, reason: decision.reason })
          continue
        }
        workspaces.push({
          repoRoot: repository.repoRoot,
          name: thread.name,
          path: thread.path,
          kind: decision.kind,
          lastUsedAt: decision.lastUsedAt,
          missing: thread.missing,
          ...(bookmarks.length > 0 && { integratedInto: bookmarks }),
        })
      }
      if (kinds.includes('secondary')) {
        const secondary = yield* threads
          .secondaryWorkspaces(repository.repoRoot)
          .pipe(Effect.catch(warnAndSkip('list secondary workspaces', repository.repoRoot)))
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- secondary workspaces are few and each registry read is a map lookup.
        for (const workspace of secondary) {
          const resolved = yield* registry.resolveByPath(workspace.path)
          const registered = resolved?.path === workspace.path ? resolved : undefined
          workspaceIds.set(workspace.path, registered?.id ?? null)
          const sessionCwds = yield* Effect.filter(sessionRecords ?? [], record =>
            WorkspaceSessionPath.includes({ fileSystem, path, sessionCwd: record.cwd, workspacePath: workspace.path }),
          )
          const sessionIds = [...new Set([...(registered?.sessionIds ?? []).map(String), ...sessionCwds.map(record => record.id)])]
          const createdAt = registered?.createdAt
          const decision = WorkspaceCleanupModel.decide({
            thread: {
              name: workspace.name,
              unlandedCount: workspace.unlanded.length,
              rebasedAt: undefined,
              sessionIds,
              integrationQueued: (yield* requests.get(workspace.path)) !== undefined,
              secondary: true,
              missing: workspace.missing,
              workingCopyState: sessionRecords === undefined ? 'unknown' : workspace.workingCopyState,
              usedAt: [changedAt.get(workspace.name), createdAt === undefined ? undefined : Date.parse(createdAt)],
            },
            archived,
            activity: currentActivity,
            now,
            olderThanMs,
            kinds,
          })
          if (decision.action === 'skip') {
            skipped.push({ repoRoot: repository.repoRoot, name: workspace.name, reason: decision.reason })
            continue
          }
          workspaces.push({
            repoRoot: repository.repoRoot,
            name: workspace.name,
            path: workspace.path,
            kind: decision.kind,
            lastUsedAt: decision.lastUsedAt,
            missing: workspace.missing,
          })
        }
      }
      const entries = kinds.includes('untracked') ? yield* threads.untrackedEntries(repository.repoRoot).pipe(Effect.orElseSucceed(() => [])) : []
      for (const entry of entries) {
        if (!WorkspaceCleanupModel.isStaleUntracked({ modifiedAt: entry.modifiedAt, now, olderThanMs, kinds })) continue
        untracked.push({ repoRoot: repository.repoRoot, name: entry.name, path: entry.path, modifiedAt: entry.modifiedAt })
      }
      if (input.apply) continue
      emptyRevisions.push(
        ...(yield* threads
          .danglingEmptyRevisions({ repoRoot: repository.repoRoot, abandon: false })
          .pipe(Effect.catch(warnAndSkip('clear empty revisions', repository.repoRoot)))),
      )
    }
    const selected = !input.apply
      ? { workspaces, untracked }
      : input.targets === undefined
        ? filterCleanupTargets({ workspaces, untracked })
        : filterCleanupTargets({ targets: input.targets, workspaces, untracked })
    return {
      scopedRepoRoot,
      repoRoots,
      skipped,
      workspaces: selected.workspaces,
      workspaceIds,
      untracked: selected.untracked,
      emptyRevisions,
    } satisfies CleanupScan
  })

  const apply = Effect.fn('cleanup apply')(function* (input: {
    readonly scan: CleanupScan
    readonly trigger: CleanupTrigger
    readonly report: CleanupReporter
  }) {
    const planned = input.scan
    const report = input.report
    const workspaces: CleanupResult['workspaces'][number][] = []
    const untracked: CleanupResult['untracked'][number][] = []
    const emptyRevisions: CleanupResult['emptyRevisions'][number][] = []
    yield* report.beginPhase('removing')
    const plannedByRepository = new Map<string, PlannedWorkspace[]>()
    for (const workspace of planned.workspaces) plannedByRepository.set(workspace.repoRoot, [...(plannedByRepository.get(workspace.repoRoot) ?? []), workspace])
    for (const [repoRoot, plannedWorkspaces] of plannedByRepository) {
      for (const workspace of plannedWorkspaces) yield* report.beginItem(workspace.name)
      const threadWorkspaces = plannedWorkspaces.filter(workspace => workspace.kind !== 'secondary')
      const secondaryWorkspaces = plannedWorkspaces.filter(workspace => workspace.kind === 'secondary')
      const threadOutcome =
        threadWorkspaces.length === 0
          ? { results: [] }
          : yield* threads.discardMany({
              repoRoot,
              names: threadWorkspaces.map(workspace => workspace.name),
              force: false,
              acceptBookmarkedWork: threadWorkspaces.some(workspace => workspace.integratedInto !== undefined),
            })
      const secondaryOutcome =
        secondaryWorkspaces.length === 0
          ? { results: [] }
          : yield* threads.discardSecondaryMany({
              repoRoot,
              workspaces: secondaryWorkspaces.map(workspace => ({ name: workspace.name, path: workspace.path, missing: workspace.missing })),
            })
      const resultByName = new Map<string, { readonly status: string; readonly error: string | null }>()
      for (const result of threadOutcome.results) resultByName.set(result.name, { status: result.status, error: result.error })
      for (const result of secondaryOutcome.results) resultByName.set(result.name, { status: result.status, error: result.message })
      // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- each removed workspace reports its progress item in order.
      for (const workspace of plannedWorkspaces) {
        const result = resultByName.get(workspace.name)
        if (result?.status === 'discarded') {
          const workspaceId = planned.workspaceIds.get(workspace.path)
          if (workspaceId !== null && workspaceId !== undefined) yield* registry.remove(workspaceId)
          yield* isolated.forget(workspace.path)
          const correlationId = randomUUID()
          yield* log.emit({ type: 'workspace.discarded', summary: `Removed JJ workspace ${workspace.name}`, path: workspace.path, correlationId })
          if (workspace.kind !== 'secondary') yield* sync.enqueue({ repoRoot, bookmark: (yield* settings.get).bookmark, correlationId })
          workspaces.push({ ...workspace, outcome: 'removed' })
          yield* report.settleItem('removed')
          continue
        }
        if (result?.status === 'has-work') {
          workspaces.push({ ...workspace, outcome: 'has-work', ...(result.error !== null && { message: result.error.slice(0, MAX_ROW_MESSAGE) }) })
          yield* report.settleItem('kept')
          continue
        }
        // The API caps a row message; a longer one (a deep thread path) would fail every read of the job.
        workspaces.push({ ...workspace, outcome: 'failed', message: (result?.error ?? 'Workspace cleanup returned no result.').slice(0, MAX_ROW_MESSAGE) })
        yield* report.settleItem('failed')
      }
    }
    // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- each removal takes its repository lock and reports its own progress item.
    for (const entry of planned.untracked) {
      yield* report.beginItem(entry.name)
      const removed = yield* threads.removeUntrackedEntry({ repoRoot: entry.repoRoot, name: entry.name }).pipe(Effect.result)
      untracked.push(
        removed._tag === 'Success'
          ? { ...entry, outcome: 'removed' }
          : { ...entry, outcome: 'failed', message: removed.failure.message.slice(0, MAX_ROW_MESSAGE) },
      )
      yield* report.settleItem(removed._tag === 'Success' ? 'removed' : 'failed')
    }
    yield* report.beginPhase('abandoning')
    // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- abandoning rewrites each repository under its lock, one at a time.
    for (const repoRoot of planned.repoRoots)
      emptyRevisions.push(
        ...(yield* threads.danglingEmptyRevisions({ repoRoot, abandon: true }).pipe(Effect.catch(warnAndSkip('clear empty revisions', repoRoot)))),
      )
    yield* views.invalidate
    const result: CleanupResult = { applied: true, workspaces, skipped: planned.skipped, untracked, emptyRevisions }
    const removedCount = CleanupJobModel.removedCount(result)
    yield* log.emit({
      type: 'workspace.cleaned',
      summary: `${input.trigger === 'automatic' ? 'Automatic cleanup removed' : 'Cleaned up'} ${String(removedCount.workspaces)} workspace(s), ${String(removedCount.untracked)} untracked entr(ies) and ${String(emptyRevisions.length)} empty revision(s)`,
      detail: CleanupJobModel.skippedSummary(result),
      path: planned.scopedRepoRoot ?? null,
      level: input.trigger === 'automatic' && removedCount.workspaces + removedCount.untracked + emptyRevisions.length === 0 ? 'routine' : 'notable',
    })
    return result
  })

  /** A failure lands in the activity timeline on the repository that owns it, with the reason and the safe next step. */
  const reportSettled = Effect.fnUntraced(function* (job: CleanupJobView) {
    for (const failure of CleanupOwnership.failures(job))
      yield* log.emit({ type: 'workspace.cleanup-failed', summary: failure.summary, detail: failure.detail, path: failure.repoRoot, level: 'attention' })
  })

  const runner = yield* CleanupRunner.make({
    onSettled: reportSettled,
    execute: ({ request, report }) =>
      Effect.gen(function* () {
        const planned = yield* scan({
          path: request.path ?? undefined,
          olderThanHours: request.olderThanHours,
          kinds: request.kinds,
          targets: request.targets,
          apply: true,
          trigger: request.trigger,
          report,
        })
        yield* report.planned(planned.workspaces.length + planned.untracked.length)
        return yield* apply({ scan: planned, trigger: request.trigger, report })
      }),
  })

  const preview = Effect.fn('cleanup preview')(function* (input: CleanupRequest) {
    const planned = yield* scan({ ...input, apply: false, trigger: 'manual' })
    return {
      applied: false,
      workspaces: planned.workspaces.map(row => ({ ...row, outcome: 'would-remove' as const })),
      skipped: planned.skipped,
      untracked: planned.untracked.map(row => ({ ...row, outcome: 'would-remove' as const })),
      emptyRevisions: planned.emptyRevisions,
    } satisfies CleanupResult
  })

  /** A request without a folder (a settle) still belongs to a project when every workspace it targets does. */
  const start = Effect.fn('cleanup start')(function* (request: CleanupJobRequest) {
    const repoRoot = request.path === null ? CleanupOwnership.ownerOfTargets(request.targets ?? []) : yield* owningRepository(request.path, runner.trail)
    return yield* runner.start(request, repoRoot)
  })

  const startManual = (input: CleanupRequest) => {
    const scope = { path: input.path ?? null, olderThanHours: input.olderThanHours, kinds: [...input.kinds], trigger: 'manual' as const }
    return start(input.targets === undefined ? scope : { ...scope, targets: [...input.targets] })
  }

  /** The trail, or only the jobs of the repository that owns `forPath` (a project or one of its thread workspaces). */
  const jobs = Effect.fn('cleanup jobs read')(function* (forPath?: string | undefined) {
    const trail = yield* runner.trail
    if (forPath === undefined) return { repoRoot: null, jobs: trail }
    const repoRoot = yield* owningRepository(forPath, Effect.succeed(trail))
    yield* Effect.annotateCurrentSpan({ 'dshx.cleanup.owner_found': repoRoot !== null })
    return { repoRoot, jobs: repoRoot === null ? trail : trail.filter(job => CleanupJobModel.belongsTo(job, repoRoot)) }
  })

  return {
    preview,
    startManual,
    start,
    live: runner.live,
    jobs,
  }
})

/** Removes idle thread workspaces through one serial job runner shared by the button, the agent tool and the scheduler. */
export class Cleanup extends Context.Service<Cleanup, Effect.Success<typeof make>>()('@dshfiles/jj-integration/Cleanup') {
  static readonly layer = Layer.effect(Cleanup, make)
}
