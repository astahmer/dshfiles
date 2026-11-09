import { DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { workspaceScriptsApi } from '@dshfiles/memory/workspace-scripts-api'
import { Clock, Duration, Effect, FiberMap, FileSystem, Layer, Option, Path, Ref, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { AUTO_CLEANUP_FIRST_RUN_DELAY, AutoCleanupModel, type AutoCleanupOutcome } from './auto-cleanup.js'
import { AUTO_FETCH_FIRST_RUN_DELAY, AutoFetchModel, type FetchOutcome } from './auto-fetch.js'
import { Cleanup } from './cleanup.js'
import { Executables } from './executables-promise.js'
import { ActivityLog, SettledThreads, WorkspaceRegistry } from './host-edges-promise.js'
import { JjSettings } from './jj-settings.js'
import { MaintenanceFailures } from './maintenance-failures.js'
import { RepositoryViews } from './repository-views.js'
import { SettleCleanupModel } from './settle-cleanup.js'
import { ThreadLifecycle } from './thread-lifecycle.js'
import { ThreadWorkspaces } from './thread-workspaces.js'
import { WorkspaceCleanupModel } from './workspace-cleanup.js'
import { WorkspaceSetupService } from './workspace-setup.js'

const HOUR_MS = 60 * 60_000
const FIRST_SWEEP_DELAY = Duration.seconds(30)
const SWEEP_INTERVAL_MINUTES = 10
/** A cleanup deletes node_modules trees, which can take minutes on a slow disk. */
const CLEANUP_SCRIPT_TIMEOUT = Duration.minutes(5)
const WARMUP_INTERVAL_MS = 750
const MAX_WARMUP_PATHS = 512

/**
 * The plugin's background upkeep, each a worker of the plugin scope: automatic fetch and cleanup on their configured
 * intervals, the finished-thread sweep, cleanup when threads settle, and warming a thread's status while it works.
 */
export const MaintenanceLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const threads = yield* ThreadWorkspaces
    const views = yield* RepositoryViews
    const registry = yield* WorkspaceRegistry
    const lifecycle = yield* ThreadLifecycle
    const cleanup = yield* Cleanup
    const settings = yield* JjSettings
    const settled = yield* SettledThreads
    const log = yield* ActivityLog
    const apis = yield* HostApis
    const executables = yield* Executables
    const workspaceSetup = yield* WorkspaceSetupService
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const failures = yield* MaintenanceFailures.make

    const located = views.locatedWorkspaces.pipe(Effect.orElseSucceed(() => []))

    /** Bounded activity probe: directory mtimes only, never a Session list or a jj process per workspace. */
    const activeRepositoryRoots = Effect.fn('maintenance active repositories')(function* (withinHours: number) {
      const lastUsedByRoot = new Map<string, number>()
      for (const entry of yield* located) {
        const root = Option.isSome(entry.location) ? entry.location.value.repoRoot : entry.workspace.path
        const modified = Option.flatMap(yield* fileSystem.stat(entry.workspace.path).pipe(Effect.option), info => info.mtime)
        const registered = Date.parse(entry.workspace.updatedAt)
        const lastUsed = Math.max(Option.isSome(modified) ? modified.value.getTime() : 0, Number.isNaN(registered) ? 0 : registered)
        lastUsedByRoot.set(root, Math.max(lastUsedByRoot.get(root) ?? 0, lastUsed))
      }
      const since = (yield* Clock.currentTimeMillis) - withinHours * HOUR_MS
      return [...lastUsedByRoot].filter(([, lastUsed]) => lastUsed >= since).map(([root]) => root)
    })

    const knownRepositoryRoots = Effect.map(located, entries => [
      ...new Set(entries.map(entry => (Option.isSome(entry.location) ? entry.location.value.repoRoot : entry.workspace.path))),
    ])
    /** Each repository once, with the VCS that located it (a location built before git support is jj's). */
    const repositoryRoots = Effect.map(located, entries => [
      ...new Map(entries.flatMap(entry => Option.toArray(entry.location).map(location => [location.repoRoot, location.vcs ?? 'jj'] as const))).entries(),
    ])

    const reportAutoCleanup = (outcome: AutoCleanupOutcome) => {
      if (outcome.status === 'busy') return Effect.logDebug(`jj-integration: automatic cleanup skipped while ${outcome.jobId} runs`)
      if (outcome.status === 'idle')
        return Effect.logDebug(`jj-integration: no repository changed in the last ${String(outcome.activeWithinHours)} h; automatic cleanup idles`)
      if (outcome.status === 'done')
        return Effect.logDebug(
          `jj-integration: automatic cleanup ran in ${String(outcome.runs.length)} repository(ies), skipped ${String(outcome.inactive)} inactive one(s)`,
        )
      if (outcome.status !== 'failed') return Effect.void
      // The cleanup job itself reports the failure to the activity timeline, on the repository that owns it.
      return Effect.logDebug(`jj-integration: automatic cleanup ${outcome.jobId} failed: ${outcome.message}`)
    }

    const reportAutoFetch = Effect.fnUntraced(function* (outcome: FetchOutcome) {
      const current = yield* settings.get
      if (outcome.status === 'failed') {
        return yield* log.emit({
          type: 'repository.fetch-failed',
          summary: `Automatic fetch failed in ${path.basename(outcome.repoRoot)}`,
          detail: AutoFetchModel.failureDetail(outcome, current.autoFetch.remote),
          path: outcome.repoRoot,
          level: 'attention',
        })
      }
      if (outcome.status !== 'fast-forwarded' && !(outcome.status === 'fetched' && outcome.bookmarkMoved)) return
      yield* views.invalidate
      yield* log.emit({
        type: 'repository.fetched',
        summary: `Automatic fetch moved ${current.bookmark} in ${path.basename(outcome.repoRoot)}`,
        path: outcome.repoRoot,
        level: 'routine',
      })
    })

    const autoFetch = Effect.gen(function* () {
      const current = yield* settings.get
      if (!current.autoFetch.enabled) return
      for (const [repoRoot, vcs] of yield* repositoryRoots) {
        const input = { repoRoot, remote: current.autoFetch.remote, bookmark: current.bookmark, fastForward: current.autoFetch.fastForwardBookmark }
        const outcome = yield* vcs === 'git' ? AutoFetchModel.fetchGitRepository(input) : AutoFetchModel.fetchRepository(input)
        yield* reportAutoFetch(outcome)
      }
    })

    const autoCleanup = Effect.gen(function* () {
      const outcome = yield* AutoCleanupModel.runOnce({
        settings: (yield* settings.get).autoCleanup,
        runner: cleanup,
        activeProjects: activeRepositoryRoots,
        knownProjects: knownRepositoryRoots,
      })
      yield* reportAutoCleanup(outcome)
    })

    /**
     * An archived thread kept for its unlanded work keeps its folder but not its dependencies: the project's cleanup
     * script (written once by memory, per project) deletes its node_modules, which setup reinstalls if it is reopened.
     */
    const runKeptThreadCleanup = Effect.fnUntraced(function* (workspacePath: string) {
      if (!(yield* fileSystem.exists(path.join(workspacePath, 'node_modules')).pipe(Effect.orElseSucceed(() => false)))) return { status: 'clean' } as const
      const scripts = yield* apis
        .client(workspaceScriptsApi)
        .scripts({ cwd: workspacePath })
        .pipe(
          Effect.catch(error =>
            error.kind === 'unavailable'
              ? Effect.succeed(null)
              : Effect.as(Effect.logWarning(`jj-integration: no cleanup script for ${workspacePath}: ${error.message}`), null),
          ),
        )
      if (scripts === null) return { status: 'no-script' } as const
      const executable = yield* executables.resolve(scripts.cleanup)
      const command = `${executable} ${workspacePath}`
      const exitCode = yield* spawner
        .spawn(
          ChildProcess.make(executable, [workspacePath], {
            cwd: process.cwd(),
            stdin: 'ignore',
            stdout: 'ignore',
            stderr: 'ignore',
            forceKillAfter: Duration.seconds(1.5),
          }),
        )
        .pipe(
          Effect.flatMap(handle => handle.exitCode),
          Effect.scoped,
          Effect.timeoutOption(CLEANUP_SCRIPT_TIMEOUT),
        )
      if (Option.isSome(exitCode) && exitCode.value === 0) return { status: 'clean' } as const
      const reason = Option.isNone(exitCode)
        ? `The cleanup script timed out after ${String(Duration.toMinutes(CLEANUP_SCRIPT_TIMEOUT))} minutes.`
        : `The cleanup script exited with code ${String(exitCode.value)}.`
      return { status: 'failed', reason, command } as const
    })

    /**
     * The script's outcome, reported on the thread's project when it fails: a failure stays in the activity timeline with
     * the command that retries it, once per reason, since every sweep tries again.
     */
    const cleanKeptThread = Effect.fn('maintenance clean kept thread')(function* (thread: {
      readonly repoRoot: string
      readonly name: string
      readonly path: string
    }) {
      const outcome = yield* runKeptThreadCleanup(thread.path).pipe(
        Effect.catch(error => Effect.succeed({ status: 'failed', reason: error.message, command: undefined } as const)),
      )
      if (outcome.status !== 'failed') return yield* failures.cleared('kept-thread', thread.path)
      yield* Effect.logWarning(`jj-integration: cleanup of archived thread ${thread.path} failed: ${outcome.reason}`)
      yield* failures.failed({ kind: 'kept-thread', ...thread, reason: outcome.reason, command: outcome.command })
    })

    /** Removes one finished thread workspace; a removal that fails is reported on its project, never forced. */
    const removeFinishedThread = Effect.fn('maintenance remove finished thread')(function* (thread: {
      readonly repoRoot: string
      readonly name: string
      readonly path: string
    }) {
      const removed = yield* lifecycle.discard({ path: thread.path, force: false }).pipe(Effect.result)
      if (removed._tag === 'Success') return yield* failures.cleared('finished-thread', thread.path)
      yield* Effect.logWarning(`jj-integration: could not remove finished thread ${thread.name}: ${removed.failure.message}`)
      yield* failures.failed({ kind: 'finished-thread', ...thread, reason: removed.failure.message })
    })

    const sweepFinishedThreads = Effect.gen(function* () {
      const current = yield* settings.get
      for (const repository of yield* views.list) {
        for (const thread of repository.threads) {
          if (!thread.finished) continue
          const owned = { repoRoot: repository.repoRoot, name: thread.name, path: thread.path }
          if (!current.removeFinishedThreads || thread.unlanded.length > 0) {
            yield* cleanKeptThread(owned)
            continue
          }
          const ready = WorkspaceCleanupModel.isFinishedWorkspaceReadyToRemove({
            finished: thread.finished,
            unlandedCount: thread.unlanded.length,
            rebasedAt: thread.rebasedAt,
            now: yield* Clock.currentTimeMillis,
            graceMs: current.removeFinishedThreadsAfterMinutes * 60_000,
          })
          if (!ready) continue
          yield* removeFinishedThread(owned)
        }
      }
    }).pipe(Effect.withSpan('maintenance sweep finished threads'))

    /** Removes the thread workspaces a settle just finished, through the shared runner so the trail and rechecks match. */
    const settleCleanup = Effect.gen(function* () {
      const snapshot = yield* Ref.make(yield* settled.read)
      yield* HostEvents.stream('settings/document-updated').pipe(
        Stream.filter(([namespace]) => namespace === SettledThreads.namespace),
        Stream.runForEach(() =>
          Effect.gen(function* () {
            const next = yield* settled.read
            const previous = yield* Ref.getAndSet(snapshot, next)
            const justSettled = previous === undefined || next === undefined ? [] : SettleCleanupModel.newlySettled({ previous, next })
            // A project can flag trusted actions for a settle; they run in the workspace the settled thread works in.
            if (justSettled.length > 0) yield* workspaceSetup.onSettle({ sessionIds: justSettled })
            const current = yield* settings.get
            if (next === undefined || justSettled.length === 0 || !current.autoCleanup.onSettle) return
            const request = AutoCleanupModel.request(current.autoCleanup, null)
            yield* SettleCleanupModel.run({
              justSettled,
              settled: next,
              kinds: request.kinds,
              repositories: views.list,
              archived: registry.archivedSessionIds,
              remove: targets => Effect.flatMap(cleanup.start({ ...request, olderThanHours: 0, targets }), started => started.done),
            }).pipe(Effect.catchCause(cause => Effect.logWarning('jj-integration: settle cleanup failed', cause)))
          }),
        ),
      )
    })

    /**
     * The Turn tail asks for this workspace's status the moment its Turn ends; the tool results that describe the work
     * arrive before that, so the same read lands in the jj view cache and the offer no longer waits for a cold read.
     */
    const warming = yield* FiberMap.make<string>()
    const lastWarmedAt = yield* Ref.make<ReadonlyMap<string, number>>(new Map())
    const warmStatus = Effect.fnUntraced(function* (cwd: string) {
      if (yield* FiberMap.has(warming, cwd)) return
      const now = yield* Clock.currentTimeMillis
      const last = (yield* Ref.get(lastWarmedAt)).get(cwd)
      if (last !== undefined && now - last < WARMUP_INTERVAL_MS) return
      yield* Ref.update(lastWarmedAt, current => new Map([...current, [cwd, now] as const].slice(-MAX_WARMUP_PATHS)))
      const read = Effect.gen(function* () {
        const location = yield* views.bestEffortLocation(cwd)
        if (Option.isNone(location) || location.value.threadName === undefined) return
        yield* threads.status(location.value.repoRoot, location.value.threadName)
      }).pipe(Effect.catch(error => Effect.logWarning(`jj-integration: warming a thread status failed: ${error.message}`)))
      yield* FiberMap.run(warming, cwd, read, { onlyIfMissing: true })
    })
    const statusWarmup = HostEvents.stream('session/event').pipe(
      // Only events that can follow a jj write warm the status; a streaming prediction token would read for nothing.
      Stream.filter(([, event]) => event.type === 'tool/result' || event.type === 'assistant/message' || event.type === 'turn/end'),
      Stream.runForEach(([session]) => {
        const cwd = session.header.cwd
        return cwd === undefined || cwd.length === 0 ? Effect.void : warmStatus(cwd)
      }),
    )

    yield* DshxPlugin.worker(
      AutoCleanupModel.schedule({
        run: autoFetch,
        intervalMinutes: Effect.map(settings.get, current => current.autoFetch.intervalMinutes),
        firstRunDelay: AUTO_FETCH_FIRST_RUN_DELAY,
      }),
    )
    yield* DshxPlugin.worker(
      AutoCleanupModel.schedule({
        run: autoCleanup,
        intervalMinutes: Effect.map(settings.get, current => current.autoCleanup.intervalMinutes),
        firstRunDelay: AUTO_CLEANUP_FIRST_RUN_DELAY,
      }),
    )
    yield* DshxPlugin.worker(
      AutoCleanupModel.schedule({ run: sweepFinishedThreads, intervalMinutes: Effect.succeed(SWEEP_INTERVAL_MINUTES), firstRunDelay: FIRST_SWEEP_DELAY }),
    )
    yield* DshxPlugin.worker(settleCleanup)
    yield* DshxPlugin.worker(statusWarmup)
  }),
)
