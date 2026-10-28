import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { Context, Effect } from '@deepseek-ai/cordis'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId, type Workspace } from '@deepseek-ai/dsh-workspace'
import { isApiOwnerMissing, PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { createHostApiClient, defineCommand, defineHost, type CommandInvocation, type CommandResult } from '@dshfiles/dshx/host'
import { withSpan } from '@dshfiles/dshx/tracing'
import { traceJjExecutor } from './jj-span.js'
import { workspaceScriptsApi } from '@dshfiles/memory/workspace-scripts-api'
import { projectChecksApi } from '@dshfiles/project-checks/api'
import type { ProjectChecksVerifiedTurn } from '@dshfiles/project-checks/completion-event'
import type { SettingsScope } from '@dshfiles/dshx/settings'
import { z } from 'zod'
import {
  jjIntegrationApi,
  type CleanupKindView,
  type CleanupResult,
  type CleanupTarget,
  type DestinationView,
  type LandResult,
  type RepositoryView,
  type ThreadView,
  type WorkspaceSyncView,
} from './api.js'
import { WorkspaceCleanupModel } from './workspace-cleanup.js'
import { filterCleanupTargets } from './cleanup-targets.js'
import { CleanupJobModel, createCleanupJobRunner, type CleanupJobReporter, type CleanupTrigger } from './cleanup-jobs.js'
import { createAutoCleanupScheduler, type AutoCleanupOutcome } from './auto-cleanup.js'
import { JsonText } from './json-text.js'
import { workspaceSyncActivity } from './workspace-sync-outcome.js'
import { ThreadStatusWarmup } from './thread-status-warmup.js'
import { WorkspaceSessionPath } from './workspace-session-path.js'
import {
  defaultJjIntegrationSettings,
  isolatesNewThreadsByDefault,
  jjIntegrationSettings,
  mayAutoIntegrateWorkspace,
  type JjIntegrationSettings,
} from './settings.js'
import {
  SESSION_ACTIVITY_PROJECTIONS,
  ThreadRebaseEligibilityModel,
  type ThreadActivityBlocker,
  type ThreadSessionActivity,
} from './thread-rebase-eligibility.js'
import { createSessionActivityCache, readWorkspaceSessionActivity as readScopedWorkspaceSessionActivity } from './session-activity-cache.js'
import { createRepositoryViewsCache } from './repository-views-cache.js'
import { createDeferredIntegrations } from './deferred-integrations.js'
import { IntegrationAttribution } from './integration-attribution.js'
import { IntegrationRecovery } from './integration-recovery.js'
import { ThreadIntegrationModel } from './thread-integration-state.js'
import { workspaceHasOtherSession } from './thread-session-ownership.js'
import { registeredProjects } from './registered-projects.js'
import { createThreads, ThreadWorkspaceModel, ThreadError, type JjExecutor, type ThreadLocation, type ThreadStatus, type Threads } from './threads.js'
import { locateBestEffort, locateOrMissing } from './workspace-location.js'

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

const MAX_OUTPUT = 512 * 1024
const MAX_STDERR = 64 * 1024
const JJ_TIMEOUT_MS = 120_000
/** A cleanup deletes node_modules trees, which can take minutes on a slow disk. */
const CLEANUP_TIMEOUT_MS = 5 * 60_000
const execFileAsync = promisify(execFile)
const SWEEP_INTERVAL_MS = 10 * 60_000
/** Installs and plugin rebuilds after a large rebase take minutes. */
const SYNC_TIMEOUT_MS = 30 * 60_000
const INTEGRATION_PROGRESS_TTL_MS = 10 * 60_000
const MAX_INTEGRATION_PROGRESS_ENTRIES = 256

type IntegrationProgressPhase = 'queued' | 'validating' | 'rebasing'
type IntegrationProgress = { readonly phase: IntegrationProgressPhase; readonly updatedAt: number }

const integrationProgressByPath = new Map<string, IntegrationProgress>()
const recordIntegrationProgress = (path: string, phase: IntegrationProgressPhase): void => {
  const now = Date.now()
  for (const [progressPath, progress] of integrationProgressByPath)
    if (now - progress.updatedAt > INTEGRATION_PROGRESS_TTL_MS) integrationProgressByPath.delete(progressPath)
  integrationProgressByPath.set(path, { phase, updatedAt: now })
  while (integrationProgressByPath.size > MAX_INTEGRATION_PROGRESS_ENTRIES) {
    const oldest = integrationProgressByPath.keys().next().value
    if (oldest === undefined) return
    integrationProgressByPath.delete(oldest)
  }
}

const readIntegrationProgress = (path: string): IntegrationProgress | null => {
  const progress = integrationProgressByPath.get(path)
  if (progress === undefined || Date.now() - progress.updatedAt > INTEGRATION_PROGRESS_TTL_MS) {
    integrationProgressByPath.delete(path)
    return null
  }
  return progress
}

let settingsScope: SettingsScope<JjIntegrationSettings> | undefined
let hostContext: Context | undefined
let threads: Threads | undefined
const isolatedSessionWorkspaces = new Map<string, { readonly name: string; readonly path: string }>()
let workspaceSync: WorkspaceSyncView | null = null
let workspaceSyncQueued = false
const pendingWorkspaceSyncs = new Map<string, WorkspaceSyncInput>()
let workspaceSyncQueue: Promise<void> = Promise.resolve()

const readSettings = (): JjIntegrationSettings => {
  try {
    return settingsScope?.get() ?? defaultJjIntegrationSettings
  } catch {
    return defaultJjIntegrationSettings
  }
}

const threadsDirectory = (repoRoot: string): string => {
  const configured = readSettings().threadsDirectory.trim()
  if (configured === '') return ThreadWorkspaceModel.defaultThreadsDirectory(repoRoot)
  const expanded = configured.startsWith('~/') ? join(homedir(), configured.slice(2)) : configured
  return join(expanded, basename(repoRoot))
}

const requireContext = (): Context => {
  if (hostContext === undefined) throw new Error('jj-integration is not active.')
  return hostContext
}

const requireThreads = (): Threads => {
  if (threads === undefined) throw new Error('jj-integration is not active.')
  return threads
}

const registryOf = () => {
  const registry = requireContext().get('workspaceRegistry')
  if (registry === undefined) throw new Error('The DSH workspace registry is unavailable.')
  return registry
}

type ActivityLevel = 'routine' | 'notable' | 'attention'
type AutoIntegrationActivityState =
  | 'queued'
  | 'cancelled'
  | 'skipped'
  | 'failed'
  | 'landed'
  | 'nothing-to-land'
  | 'already-integrated'
  | 'patch-equivalent-work'
  | 'patch-equivalence-unavailable'
  | 'conflicted'
  | 'needs-description'
  | 'detached-work'
  | 'verification-failed'

const emitActivity = (input: {
  readonly type: string
  readonly summary: string
  readonly detail?: string | undefined
  readonly path: string | null
  readonly sessionId?: string | null | undefined
  readonly correlationId?: string | undefined
  readonly level?: ActivityLevel | undefined
}): void => {
  const at = Date.now()
  const path = input.path === null || input.path.length === 0 ? null : input.path
  // Reporting must never take the host down: emit runs listeners synchronously, often from a timer here.
  try {
    hostContext?.emit('dshfiles/activity/event', {
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
        workspaceName: path === null ? null : basename(path),
      },
    })
  } catch (error) {
    hostContext?.logger.warn('jj-integration: activity event dropped: %s', error instanceof Error ? error.message : String(error))
  }
}

const safePromptField = (value: string, maximumLength: number): string =>
  [...value]
    .map(character => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? ' ' : character
    })
    .join('')
    .replaceAll('`', "'")
    .slice(0, maximumLength)

const createExecutor = (context: Context): JjExecutor => traceJjExecutor(createUntracedExecutor(context))

const createUntracedExecutor =
  (context: Context): JjExecutor =>
  async input => {
    const executable = await context.subprocess.resolveExecutable('jj', undefined, input.signal)
    const signal = input.signal === undefined ? AbortSignal.timeout(JJ_TIMEOUT_MS) : AbortSignal.any([input.signal, AbortSignal.timeout(JJ_TIMEOUT_MS)])
    const handle = context.subprocess.spawn({
      argv: [executable, '--color=never', '--no-pager', ...input.args],
      cwd: input.cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT }, stderr: { maxBytes: MAX_STDERR } },
      graceMs: 1_500,
      signal,
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0)
    return {
      exitCode: outcome.exitCode ?? 1,
      stdout: stdout?.text ?? '',
      stdoutLossy: stdout?.lossy ?? true,
      stderr: handle.collected.stderr?.readFrom(0)?.text ?? '',
    }
  }

const isolatedSessionIdsAt = (path: string): readonly string[] =>
  [...isolatedSessionWorkspaces].flatMap(([sessionId, workspace]) => (workspace.path === path ? [sessionId] : []))

/** A full Session activity fold is kept for display and repository-wide cleanup, but never gates one thread rebase. */
const SESSION_ACTIVITY_TTL_MS = 30_000
const SESSION_ACTIVITY_DISPLAY_BUDGET_MS = 2_500
const SESSION_ACTIVITY_GUARD_BUDGET_MS = 15_000
/** Budgets one guard spends on the same workspace-scoped read before reporting unknown. */
const SESSION_ACTIVITY_GUARD_ATTEMPTS = 3
const SESSION_ACTIVITY_GUARD_CEILING_MS = 60_000
const readSessionActivity = (signal: AbortSignal): Promise<ReadonlyMap<string, ThreadSessionActivity> | undefined> => {
  const controller = requireContext().get('sessionController')
  if (controller === undefined) return Promise.resolve(undefined)
  return controller
    .list({ projections: SESSION_ACTIVITY_PROJECTIONS }, signal)
    .then(result => {
      const activity = new Map<string, ThreadSessionActivity>()
      for (const item of result.items) {
        activity.set(item.sessionId, {
          running: item.running,
          pendingUserQuestion: ThreadRebaseEligibilityModel.hasPendingUserQuestion(item.projections?.values),
          title: item.projections?.values.title ?? undefined,
          blank: item.blank,
        })
      }
      return activity
    })
    .catch(() => undefined)
}

const readWorkspaceSessionActivity = (sessionIds: readonly string[], signal: AbortSignal): Promise<ReadonlyMap<string, ThreadSessionActivity> | undefined> => {
  const context = requireContext()
  const controller = context.get('sessionController')
  if (controller === undefined) return Promise.resolve(undefined)
  return readScopedWorkspaceSessionActivity({
    sessionIds,
    signal,
    getRunning: sessionId => context.agents.get(SessionId(sessionId))?.status === 'running',
    readProjections: sessionId => controller.projections({ sessionId: SessionId(sessionId) }, signal),
    readFallback: async sessionIds => {
      const result = await controller.list({ projections: SESSION_ACTIVITY_PROJECTIONS }, signal)
      const wanted = new Set(sessionIds)
      return new Map(
        result.items
          .filter(item => wanted.has(item.sessionId))
          .map(item => [
            item.sessionId,
            {
              running: item.running,
              pendingUserQuestion: ThreadRebaseEligibilityModel.hasPendingUserQuestion(item.projections?.values),
              title: item.projections?.values.title ?? undefined,
              blank: item.blank,
            },
          ]),
      )
    },
  })
}

/**
 * Display and repository-wide cleanup need activity across the store, so the shared cache serves the last good full
 * snapshot while refreshing it in the background. A rebase guard bypasses this fold with workspace-scoped reads.
 */
const sessionActivity = createSessionActivityCache({
  read: readSessionActivity,
  readGuard: readWorkspaceSessionActivity,
  ttlMs: SESSION_ACTIVITY_TTL_MS,
  displayBudgetMs: SESSION_ACTIVITY_DISPLAY_BUDGET_MS,
  guardBudgetMs: SESSION_ACTIVITY_GUARD_BUDGET_MS,
  guardAttempts: SESSION_ACTIVITY_GUARD_ATTEMPTS,
  guardCeilingMs: SESSION_ACTIVITY_GUARD_CEILING_MS,
})

type ThreadIntegrationView = NonNullable<ThreadView['integrations']>[number]

/** A fork's boundary never moves, so one observation per forked Session serves every Turn tail of its conversation. */
const MAX_FORK_CUT_ENTRIES = 256
const forkCuts = new Map<string, number>()

/**
 * A forked Session copies its parent's transcript but keeps working in the parent's jj workspace, so that workspace
 * keeps recording the parent's later lands. The fork's boundary is the last event it inherited, not its creation: a
 * branch can be cut at an earlier Turn, and only lands recorded up to that point belong to the copied conversation.
 */
const sessionForkedAt = async (sessionId: string | undefined): Promise<number | undefined> => {
  if (sessionId === undefined) return undefined
  const known = forkCuts.get(sessionId)
  if (known !== undefined) return known
  try {
    const snapshot = await requireContext().sessionPersistence.stat(SessionId(sessionId))
    if (snapshot?.header.isSeeded !== true) return undefined
    const observation = await requireContext().sessionQuery.observeSession(SessionId(sessionId), { projectionMode: 'none' })
    try {
      const cut = observation.events[observation.inheritedEventCount - 1]?.time
      if (cut === undefined) return undefined
      forkCuts.set(sessionId, cut)
      while (forkCuts.size > MAX_FORK_CUT_ENTRIES) {
        const oldest = forkCuts.keys().next().value
        if (oldest === undefined) break
        forkCuts.delete(oldest)
      }
      return cut
    } finally {
      observation[Symbol.dispose]()
    }
  } catch {
    return undefined
  }
}

const threadView = (
  status: ThreadStatus,
  workspace: Workspace | undefined,
  archived: ReadonlySet<string>,
  activity: ReadonlyMap<string, ThreadSessionActivity> | undefined,
  caller: { readonly fromAgent: boolean; readonly sessionId: string | undefined } = { fromAgent: false, sessionId: undefined },
  attribution: { readonly sessionId: string | undefined; readonly forkCutAt: number | undefined } | undefined = undefined,
): ThreadView => {
  const sessionIds = [...new Set([...(workspace?.sessionIds ?? []), ...isolatedSessionIdsAt(status.path)])]
  const blankSessionIds = new Set(sessionIds.filter(sessionId => activity?.get(sessionId)?.blank === true))
  const canRebase = ThreadRebaseEligibilityModel.eligibility({ sessionIds, activity, fromAgent: caller.fromAgent, sessionId: caller.sessionId })
  const viewerSessionId = attribution?.sessionId
  const forkCutAt = attribution?.forkCutAt
  const view: ThreadView = {
    name: status.name,
    path: status.path,
    workspaceId: workspace?.id ?? null,
    sessionIds,
    finished: ThreadIntegrationModel.isFinishedThread(sessionIds, archived, blankSessionIds),
    missing: status.missing,
    behind: status.behind,
    behindCount: status.behindCount,
    unlanded: [...status.unlanded],
  }
  const withWorkspaceTitle: ThreadView = workspace === undefined ? view : { ...view, workspaceTitle: workspace.title }
  const withEligibility: ThreadView = canRebase === undefined ? withWorkspaceTitle : { ...withWorkspaceTitle, canRebase }
  const visible = IntegrationAttribution.forSession({ records: deferredIntegrations.history(status.path), sessionId: viewerSessionId, forkCutAt })
  const queueEvents = visible.map(event => ({ at: event.at, kind: event.kind }))
  const queuedEntry = deferredIntegrations.get(status.path)
  const integrationQueuedAt =
    queuedEntry !== undefined && (viewerSessionId === undefined || queuedEntry.sessionId === undefined || queuedEntry.sessionId === viewerSessionId)
      ? queuedEntry.queuedAt
      : undefined
  const withQueueEvents: ThreadView = { ...withEligibility, integrationQueueEvents: queueEvents }
  const withQueue: ThreadView = integrationQueuedAt === undefined ? withQueueEvents : { ...withQueueEvents, integrationQueuedAt }
  if (status.rebasedAt === undefined) return withQueue
  const integrations = IntegrationAttribution.forSession({ records: status.integrations ?? [], sessionId: viewerSessionId, forkCutAt }).map(record => {
    const visibleRecord: ThreadIntegrationView = { at: record.at }
    if (record.tipChangeId !== undefined) visibleRecord.tipChangeId = record.tipChangeId
    return visibleRecord
  })
  const viewWithRebaseTimestamp = { ...withQueue, rebasedAt: status.rebasedAt, integrations }
  if (status.rebasedTipChangeId === undefined) return viewWithRebaseTimestamp
  return { ...viewWithRebaseTimestamp, rebasedTipChangeId: status.rebasedTipChangeId }
}

/**
 * A repository scan costs one `jj` process per workspace and two more per thread, while the New thread screen and the
 * sidebar ask for it. Every layer is cached and every scan is single-flight: a poll storm shares one scan instead of
 * pinning one browser connection per caller, and a mutation is the only thing that reads them all again. A registered
 * folder's repository and workspace identity never change, so it outlives the statuses that do.
 */
const LOCATION_CACHE_TTL_MS = 30 * 60_000
const THREAD_STATUS_CACHE_TTL_MS = 30_000
const REPOSITORY_VIEW_TTL_MS = 60_000
/** One `jj workspace list` plus two revsets per thread, so repositories are scanned a bounded few at a time. */
const REPOSITORY_SCAN_CONCURRENCY = 4

type Cached<Value> = { readonly value: Value; readonly at: number }

const locationCache = new Map<string, Cached<ThreadLocation | undefined>>()
const threadStatusCache = new Map<string, Cached<readonly ThreadStatus[]>>()

/**
 * A registered workspace's location never moves, and most registered folders are not jj repositories at all: caching
 * the misses too keeps a store with dozens of workspaces from paying one `jj` process each per scan.
 */
const cachedLocation = async (threads: Threads, path: string): Promise<ThreadLocation | undefined> => {
  const cached = locationCache.get(path)
  if (cached !== undefined && Date.now() - cached.at < LOCATION_CACHE_TTL_MS) return cached.value
  const location = await locateOrMissing(() => threads.locate(path))
  locationCache.set(path, { value: location, at: Date.now() })
  return location
}

const cachedBestEffortLocation = async (threads: Threads, path: string): Promise<ThreadLocation | undefined> =>
  locateBestEffort(() => cachedLocation(threads, path))

/** Registered workspaces whose folders still exist, so one missing entry cannot cost a process per scan. */
const presentWorkspaces = (workspaces: readonly Workspace[]): readonly Workspace[] => workspaces.filter(workspace => existsSync(workspace.path))

/** Reads them a bounded number at a time: one `jj` process each, and the scan runs while the user is working. */
const LOCATE_CONCURRENCY = 8

const mapBounded = async <Item, Result>(items: readonly Item[], limit: number, run: (item: Item) => Promise<Result>): Promise<readonly Result[]> => {
  const results = new Array<Result>(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++
      const item = items[index]
      if (item === undefined) return
      results[index] = await run(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

const cachedThreadStatuses = async (threads: Threads, repoRoot: string): Promise<readonly ThreadStatus[]> => {
  const cached = threadStatusCache.get(repoRoot)
  if (cached !== undefined && Date.now() - cached.at < THREAD_STATUS_CACHE_TTL_MS) return cached.value
  const statuses = await threads.list(repoRoot)
  threadStatusCache.set(repoRoot, { value: statuses, at: Date.now() })
  return statuses
}

/** Every registered project that is the owning checkout of a jj repository, with its thread workspaces. */
const scanRepositories = async (): Promise<readonly RepositoryView[]> => {
  const registry = registryOf()
  const active = requireThreads()
  const workspaces = registry.list()
  const byPath = new Map(workspaces.map(workspace => [workspace.path, workspace]))
  const archived = new Set<string>(registry.archivedSessionIds)
  const activity = await sessionActivity.display()
  const present = presentWorkspaces(workspaces)
  const locations = await mapBounded(present, LOCATE_CONCURRENCY, workspace => cachedBestEffortLocation(active, workspace.path))
  const repoRoots = [...new Set(locations.flatMap(location => (location === undefined ? [] : [location.repoRoot])))]
  const statusesByRepo = await mapBounded(repoRoots, REPOSITORY_SCAN_CONCURRENCY, repoRoot => cachedThreadStatuses(active, repoRoot))
  return repoRoots.map((repoRoot, index) => {
    const owner = byPath.get(repoRoot)
    return {
      repoRoot,
      title: owner?.title ?? basename(repoRoot),
      workspaceId: owner?.id ?? null,
      threads: (statusesByRepo[index] ?? []).map(status => threadView(status, byPath.get(status.path), archived, activity)),
    }
  })
}

const repositoryViewsCache = createRepositoryViewsCache({ read: scanRepositories, ttlMs: REPOSITORY_VIEW_TTL_MS })

const invalidateRepositories = (): void => {
  repositoryViewsCache.invalidate()
  threadStatusCache.clear()
  sessionActivity.reset()
}

const listRepositorySnapshot = () => {
  const snapshot = repositoryViewsCache.read()
  return {
    repositories: [...(snapshot.value ?? [])],
    refreshing: snapshot.refreshing,
    refreshFailed: snapshot.refreshFailed,
  }
}

const listRepositories = (): Promise<readonly RepositoryView[]> => repositoryViewsCache.refreshAndRead()

const findThread = async (input: {
  readonly location: ThreadLocation
  readonly includeActivity?: boolean
  /** The Session asking, so its own turn is not counted against the thread it wants to rebase. */
  readonly caller?: { readonly fromAgent: boolean; readonly sessionId: string | undefined } | undefined
  /** The Session reading the view, so integration notices show only the lands its conversation knows about. */
  readonly viewerSessionId?: string | undefined
}): Promise<{ readonly repoRoot: string; readonly thread: ThreadView } | undefined> => {
  const location = input.location
  if (location.threadName === undefined) return undefined
  const active = requireThreads()
  const registry = registryOf()
  const workspace = await registry.resolveByPath(location.workspaceRoot)
  const shouldReadActivity = input.includeActivity !== false && workspace !== undefined && workspace.sessionIds.length > 0
  const viewerSessionId = input.viewerSessionId
  const [threadStatus, activity, forkCutAt] = await Promise.all([
    active.status(location.repoRoot, location.threadName),
    shouldReadActivity ? sessionActivity.display() : Promise.resolve(undefined),
    viewerSessionId === undefined ? Promise.resolve(undefined) : sessionForkedAt(viewerSessionId),
  ])
  return {
    repoRoot: location.repoRoot,
    thread: threadView(
      threadStatus,
      workspace,
      new Set(registry.archivedSessionIds),
      activity,
      input.caller,
      viewerSessionId === undefined ? undefined : { sessionId: viewerSessionId, forkCutAt },
    ),
  }
}

const landingMessage = (outcome: LandResult): string | undefined => {
  const bookmark = outcome.bookmark
  if (outcome.status === 'conflicted') {
    return [
      `Rebasing this thread onto \`${bookmark}\` stopped with conflicts in:`,
      ...outcome.files.map(file => `- ${file}`),
      'Resolve them in this workspace (edit the files so no conflict markers remain; the conflicted revisions are already rebased), keep every revision described, then call the `jj_thread_rebase` tool again.',
    ].join('\n')
  }
  if (outcome.status === 'needs-description') {
    return [
      `Rebasing this thread onto \`${bookmark}\` stopped because these revisions have no real description:`,
      ...outcome.revisions.map(revision => `- ${revision.changeId}`),
      'Describe each one with `jj describe -r <change-id> -m "<conventional commit message>"` (split unrelated changes with `jj split` first), then call the `jj_thread_rebase` tool again.',
    ].join('\n')
  }
  return undefined
}

const askAgent = async (path: string, sessionId: string | undefined, text: string): Promise<boolean> => {
  const context = requireContext()
  const controller = context.get('sessionController')
  if (controller === undefined) return false
  const workspace = await registryOf().resolveByPath(path)
  const archived = new Set<string>(registryOf().archivedSessionIds)
  const target = sessionId ?? [...(workspace?.sessionIds ?? [])].reverse().find(candidate => !archived.has(candidate))
  if (target === undefined) return false
  // SAFETY: SessionRequestId is a type-only brand, so the unique id `randomUUID` mints is a valid one.
  const requestId = randomUUID() as SessionRequestId
  await controller.prompt({ requestId, sessionId: SessionId(target), mode: 'queue', content: [{ type: 'text', text }] }, AbortSignal.timeout(15_000))
  return true
}

const checkoutSyncOutputSchema = z.object({
  ok: z.boolean(),
  data: z
    .object({
      status: z.enum(['up-to-date', 'synced', 'would-sync', 'refused', 'conflicted', 'build-failed']),
      rebuilt: z.object({ plugins: z.array(z.string()) }),
      plugins: z.array(z.object({ name: z.string(), host: z.boolean(), client: z.boolean() })),
      restart: z.object({ needed: z.boolean() }),
      conflicts: z.array(z.string()),
      hint: z.string().nullable(),
    })
    .optional(),
  error: z.object({ message: z.string(), hint: z.string() }).optional(),
})

interface WorkspaceSyncInput {
  readonly repoRoot: string
  readonly workspace: string
  readonly bookmark: string
  readonly revision?: string | undefined
  readonly sessionId?: string | null | undefined
  readonly correlationId?: string | undefined
}

const workspaceSyncView = (input: WorkspaceSyncInput, state: WorkspaceSyncView['state'], message: string | null): WorkspaceSyncView => ({
  workspace: input.workspace,
  bookmark: input.bookmark,
  state,
  status: null,
  pluginsRebuilt: [],
  hotPlugins: [],
  restartNeeded: false,
  conflicts: [],
  message,
  finishedAt: state === 'running' ? null : new Date().toISOString(),
})

const runWorkspaceSync = (input: WorkspaceSyncInput): Promise<WorkspaceSyncView> =>
  withSpan(
    'jj-integration workspace sync',
    { attributes: { 'dshx.checkout.workspace': input.workspace, 'dshx.checkout.bookmark': input.bookmark } },
    async span => {
      const view = await runUntracedWorkspaceSync(input)
      span.setAttributes({
        'dshx.checkout.state': view.state,
        'dshx.checkout.status': view.status ?? undefined,
        'dshx.checkout.rebuilt_plugins': view.pluginsRebuilt.length,
        'dshx.checkout.restart_needed': view.restartNeeded,
      })
      if (view.state === 'failed') span.setStatus('error', 'sync failed')
      return view
    },
  )

const runUntracedWorkspaceSync = async (input: WorkspaceSyncInput): Promise<WorkspaceSyncView> => {
  const failed = (message: string): WorkspaceSyncView => workspaceSyncView(input, 'failed', message)
  let argv: readonly string[]
  try {
    argv = ThreadWorkspaceModel.checkoutSyncArgv(input)
  } catch {
    return failed('dshx is not installed beside jj-integration; run `pnpm --dir plugins install --frozen-lockfile` in the repository.')
  }
  const handle = requireContext().subprocess.spawn({
    argv: [...argv],
    cwd: input.repoRoot,
    stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT }, stderr: { maxBytes: MAX_STDERR } },
    graceMs: 5_000,
    signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
  })
  await handle.done
  const stdout = handle.collected.stdout?.readFrom(0)?.text ?? ''
  const output = JsonText.decode(checkoutSyncOutputSchema, stdout)
  if (output === undefined) return failed(`dshx checkout sync printed no result: ${(handle.collected.stderr?.readFrom(0)?.text ?? '').trim().slice(-400)}`)
  if (!output.success) return failed('dshx checkout sync printed a result this plugin cannot read; rebuild dshx.')
  const data = output.data.data
  if (data === undefined)
    return failed(output.data.error === undefined ? 'dshx checkout sync failed.' : `${output.data.error.message} ${output.data.error.hint}`)
  return {
    ...workspaceSyncView(input, output.data.ok ? 'done' : 'failed', data.hint),
    status: data.status,
    pluginsRebuilt: data.rebuilt.plugins,
    hotPlugins: data.plugins.filter(plugin => plugin.client && !plugin.host).map(plugin => plugin.name),
    restartNeeded: data.restart.needed,
    conflicts: data.conflicts,
  }
}

/** Runs exact-commit syncs serially and coalesces pending work per repository. */
const queueWorkspaceSync = (input: {
  readonly repoRoot: string
  readonly bookmark: string
  readonly revision?: string | undefined
  readonly sessionId?: string | null | undefined
  readonly correlationId?: string | undefined
}): void => {
  const workspace = readSettings().syncWorkspaceAfterLand.trim()
  if (workspace === '') return
  const nextInput: WorkspaceSyncInput = { ...input, workspace }
  pendingWorkspaceSyncs.set(nextInput.repoRoot, nextInput)
  workspaceSync = workspaceSyncView(nextInput, 'running', null)
  if (workspaceSyncQueued) return
  workspaceSyncQueued = true
  workspaceSyncQueue = workspaceSyncQueue
    .then(async () => {
      try {
        while (pendingWorkspaceSyncs.size > 0) {
          const next = pendingWorkspaceSyncs.entries().next().value
          if (next === undefined) break
          const [repoRoot, current] = next
          pendingWorkspaceSyncs.delete(repoRoot)
          workspaceSync = workspaceSyncView(current, 'running', null)
          const view = await runWorkspaceSync(current).catch(error =>
            workspaceSyncView(current, 'failed', error instanceof Error ? error.message : String(error)),
          )
          workspaceSync = view
          emitActivity({
            ...workspaceSyncActivity(view),
            path: current.repoRoot,
            sessionId: current.sessionId,
            correlationId: current.correlationId,
          })
        }
      } finally {
        workspaceSyncQueued = false
      }
    })
    .catch(error => {
      workspaceSyncQueued = false
      hostContext?.logger.warn('jj-integration: queued checkout sync failed: %o', error)
    })
}

/**
 * One thread workspace can hold several DSH Sessions, so a refusal names the ones actually keeping it busy instead of
 * blaming the thread the user is looking at.
 */
const busyWorkspaceMessage = (blockers: readonly ThreadActivityBlocker[]): string => {
  if (blockers.length === 0) return 'This workspace is still in use. Integrate once every thread in it is idle.'
  const named = blockers.map(
    blocker => `“${blocker.title ?? blocker.sessionId}” ${blocker.reason === 'working' ? 'is still working' : 'is waiting for an answer'}`,
  )
  return `This workspace is still in use: ${named.join('; ')}. Integrate once every thread in it is idle.`
}

const landThread = async (input: {
  readonly path: string
  readonly sessionId: string | undefined
  readonly fromAgent: boolean
  readonly signal?: AbortSignal
  /** A queued integration's last chance to be cancelled: read once the guard passed, right before the rebase. */
  readonly stillQueued?: () => boolean
}): Promise<LandResult> => {
  recordIntegrationProgress(input.path, 'queued')
  const bookmark = readSettings().bookmark
  const correlationId = randomUUID()
  const activeThreads = requireThreads()
  const location = await activeThreads.locate(input.path)
  const validate = async (): Promise<void> => {
    if (location.threadName === undefined) return
    const workspace = await registryOf().resolveByPath(location.workspaceRoot)
    if (workspace === undefined) throw new PluginApiError('Could not verify thread activity before rebasing.', { code: 'thread-activity-unknown' })
    const activity = await sessionActivity.guard(workspace.sessionIds)
    const eligible = ThreadRebaseEligibilityModel.eligibility({
      sessionIds: workspace.sessionIds,
      activity,
      fromAgent: input.fromAgent,
      sessionId: input.sessionId,
    })
    if (eligible === undefined) {
      // Manual integrations are not dead-ended by an unverifiable activity read: queue the same guarded rebase and let
      // the deferred retry run it once the Host can read idleness. An Agent's own call still reports why it stopped.
      if (!IntegrationRecovery.queuesInsteadOfRefusing({ fromAgent: input.fromAgent, retrying: input.stillQueued !== undefined })) {
        throw new PluginApiError('Could not verify whether this workspace is idle. Refresh and retry integration.', { code: 'thread-activity-unknown' })
      }
      await queueIntegration({ path: input.path, sessionId: input.sessionId })
      throw new PluginApiError('This workspace is not verifiably idle yet; the integration is queued.', { code: 'integration-queued' })
    }
    if (!eligible) {
      const blockers = ThreadRebaseEligibilityModel.blockers({ sessionIds: workspace.sessionIds, activity })
      throw new PluginApiError(busyWorkspaceMessage(blockers), { code: 'thread-active' })
    }
    if (input.stillQueued?.() === false) throw new PluginApiError('The queued integration was cancelled.', { code: 'integration-cancelled' })
  }
  const threadName = location.threadName
  if (threadName === undefined) throw new PluginApiError('This workspace is not a thread.', { code: 'not-a-thread' })
  const onProgress = (phase: IntegrationProgressPhase): void => recordIntegrationProgress(input.path, phase)
  const landOptions = { bookmark, sessionId: input.sessionId, validate, onProgress }
  const outcome = await activeThreads.landAt({ ...location, threadName }, input.signal === undefined ? landOptions : { ...landOptions, signal: input.signal })
  if (outcome.status === 'landed' || outcome.status === 'nothing-to-land') invalidateRepositories()
  const result: LandResult = {
    status: outcome.status,
    revisions: outcome.status === 'nothing-to-land' ? [] : [...outcome.revisions],
    files: outcome.status === 'conflicted' ? [...outcome.files] : [],
    bookmark,
    agentAsked: false,
  }
  if (outcome.status === 'landed') result.head = outcome.head
  const message = landingMessage(result)
  const agentAsked =
    message !== undefined && !input.fromAgent && readSettings().askAgentToFixLanding
      ? await askAgent(input.path, input.sessionId, message).catch(() => false)
      : false
  if (outcome.status === 'landed') {
    queueWorkspaceSync({
      repoRoot: location.repoRoot,
      bookmark,
      revision: outcome.head.commitId,
      sessionId: input.sessionId,
      correlationId,
    })
  }
  emitActivity({
    type: `workspace.rebase_${outcome.status.replaceAll('-', '_')}`,
    level: outcome.status === 'landed' || outcome.status === 'nothing-to-land' ? 'notable' : 'attention',
    summary:
      outcome.status === 'landed'
        ? `Rebased ${String(outcome.revisions.length)} revision(s) from ${basename(input.path)} onto ${bookmark}`
        : `Rebase ${outcome.status} in ${basename(input.path)}`,
    path: input.path,
    sessionId: input.sessionId,
    correlationId,
  })
  return { ...result, agentAsked }
}

const isWaitingForIdleThread = (error: unknown): boolean =>
  error instanceof PluginApiError && (error.code === 'thread-active' || error.code === 'thread-activity-unknown')

const deferredIntegrations = createDeferredIntegrations({
  land: ({ entry, stillQueued }) => landThread({ path: entry.path, sessionId: entry.sessionId, fromAgent: false, stillQueued }),
  isWaitingError: isWaitingForIdleThread,
  onSettled: (entry, settlement) => {
    invalidateRepositories()
    if (settlement.kind === 'result') return
    emitActivity({
      type: 'workspace.queued_integration_failed',
      level: 'attention',
      summary: `Queued integration of ${basename(entry.path)} stopped before rebasing`,
      detail: settlement.error instanceof Error ? settlement.error.message : undefined,
      path: entry.path,
      sessionId: entry.sessionId,
    })
  },
})

/** Session events arrive in bursts while a turn streams; a queued integration retries once its thread went quiet. */
const DEFERRED_INTEGRATION_SETTLE_MS = 1_500
/** Catches idleness no Session event announced, e.g. a question dismissed from another client. */
const DEFERRED_INTEGRATION_FALLBACK_MS = 30_000
let deferredIntegrationWake: ReturnType<typeof setTimeout> | undefined

const wakeDeferredIntegrations = (delayMs: number): void => {
  if (deferredIntegrationWake !== undefined) clearTimeout(deferredIntegrationWake)
  deferredIntegrationWake = setTimeout(() => {
    deferredIntegrationWake = undefined
    void deferredIntegrations.drain().catch(error => hostContext?.logger.warn('jj-integration: queued integration failed: %o', error))
  }, delayMs)
  deferredIntegrationWake.unref()
}

const queueIntegration = async (input: { readonly path: string; readonly sessionId: string | undefined }): Promise<{ readonly queuedAt: number }> => {
  const location = await cachedBestEffortLocation(requireThreads(), input.path)
  if (location?.threadName === undefined) throw new PluginApiError('This workspace is not a thread.', { code: 'not-a-thread' })
  const entry = deferredIntegrations.queue({ path: location.workspaceRoot, sessionId: input.sessionId })
  // Queueing changes no jj state, only what the assembled repository views report.
  repositoryViewsCache.invalidate()
  emitActivity({
    type: 'workspace.integration_queued',
    level: 'routine',
    summary: `Queued integration of ${basename(entry.path)} until the thread is idle`,
    path: entry.path,
    sessionId: entry.sessionId,
  })
  wakeDeferredIntegrations(0)
  return { queuedAt: entry.queuedAt }
}

const cancelQueuedIntegration = (path: string) => {
  const status = deferredIntegrations.cancel(path)
  if (status === 'cancelled') {
    repositoryViewsCache.invalidate()
    emitActivity({ type: 'workspace.integration_unqueued', level: 'routine', summary: `Cancelled the queued integration of ${basename(path)}`, path })
  }
  return { status }
}

const discardThread = async (input: { readonly path: string; readonly force: boolean }) => {
  const location = await requireThreads()
    .locate(input.path)
    .catch(() => undefined)
  const found = location === undefined ? undefined : await findThread({ location })
  if (found === undefined) throw new Error(`${input.path} is not a thread workspace.`)
  const outcome = await requireThreads().discard({ repoRoot: found.repoRoot, name: found.thread.name, force: input.force })
  if (outcome.status === 'discarded') {
    if (found.thread.workspaceId !== null) await registryOf().delete(WorkspaceId(found.thread.workspaceId))
    for (const [sessionId, workspace] of isolatedSessionWorkspaces) {
      if (workspace.path === found.thread.path) isolatedSessionWorkspaces.delete(sessionId)
    }
    const correlationId = randomUUID()
    emitActivity({ type: 'workspace.discarded', summary: `Removed thread workspace ${found.thread.name}`, path: input.path, correlationId })
    queueWorkspaceSync({ repoRoot: found.repoRoot, bookmark: readSettings().bookmark, correlationId })
    invalidateRepositories()
  }
  return { status: outcome.status, revisions: outcome.status === 'has-work' ? [...outcome.revisions] : [] }
}

const discardThreads = async (input: { readonly paths: readonly string[]; readonly force: boolean }) => {
  const results: {
    readonly path: string
    readonly status: 'discarded' | 'has-work' | 'error'
    readonly revisions: Awaited<ReturnType<typeof discardThread>>['revisions']
    readonly error: string | null
  }[] = []
  for (const path of input.paths) {
    try {
      const result = await discardThread({ path, force: input.force })
      results.push({ path, ...result, error: null })
    } catch (error) {
      results.push({ path, status: 'error', revisions: [], error: errorText(error) })
    }
  }
  return { results }
}

const HOUR_MS = 60 * 60_000

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 400)

type PlannedWorkspace = Omit<CleanupResult['workspaces'][number], 'outcome' | 'message'>
type PlannedUntracked = Omit<CleanupResult['untracked'][number], 'outcome' | 'message'>

interface CleanupRequest {
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

const scanCleanup = async (input: CleanupRequest & { readonly apply: boolean; readonly trigger: CleanupTrigger }): Promise<CleanupScan> => {
  const active = requireThreads()
  const kinds = input.trigger === 'automatic' ? input.kinds.filter(kind => kind !== 'secondary') : input.kinds
  const scopedRepoRoot = input.path === undefined ? undefined : (await active.locate(input.path)).repoRoot
  invalidateRepositories()
  const [repositories, activity, sessionRecords] = await Promise.all([
    listRepositories(),
    input.apply ? sessionActivity.guard() : sessionActivity.display(),
    kinds.includes('secondary')
      ? Promise.resolve()
          .then(() => requireContext().sessionQuery.listSessions())
          .catch(() => undefined)
      : Promise.resolve([]),
  ])
  const registry = registryOf()
  const archived = new Set<string>(registry.archivedSessionIds)
  const now = Date.now()
  const repoRoots: string[] = []
  const workspaces: PlannedWorkspace[] = []
  const workspaceIds = new Map<string, string | null>()
  const skipped: CleanupResult['skipped'] = []
  const emptyRevisions: CleanupResult['emptyRevisions'] = []
  const untracked: PlannedUntracked[] = []
  for (const repository of repositories) {
    if (scopedRepoRoot !== undefined && repository.repoRoot !== scopedRepoRoot) continue
    repoRoots.push(repository.repoRoot)
    const changedAt = await active.workingCopyChangedAt(repository.repoRoot).catch(() => new Map<string, number>())
    for (const thread of repository.threads) {
      workspaceIds.set(thread.path, thread.workspaceId)
      const createdAt = thread.workspaceId === null ? undefined : registry.get(WorkspaceId(thread.workspaceId))?.createdAt
      const decision = WorkspaceCleanupModel.decide({
        thread: {
          name: thread.name,
          unlandedCount: thread.unlanded.length,
          rebasedAt: thread.rebasedAt,
          sessionIds: thread.sessionIds,
          integrationQueued: deferredIntegrations.get(thread.path) !== undefined,
          usedAt: [changedAt.get(thread.name), thread.rebasedAt, createdAt === undefined ? undefined : Date.parse(createdAt)],
        },
        archived,
        activity,
        now,
        olderThanMs: input.olderThanHours * HOUR_MS,
        kinds,
      })
      if (decision.action === 'skip') {
        skipped.push({ repoRoot: repository.repoRoot, name: thread.name, reason: decision.reason })
        continue
      }
      workspaces.push({ repoRoot: repository.repoRoot, name: thread.name, path: thread.path, kind: decision.kind, lastUsedAt: decision.lastUsedAt })
    }
    if (kinds.includes('secondary')) {
      const secondary = await active.secondaryWorkspaces(repository.repoRoot)
      for (const workspace of secondary) {
        const resolved = await registry.resolveByPath(workspace.path)
        const registered = resolved?.path === workspace.path ? resolved : undefined
        workspaceIds.set(workspace.path, registered?.id ?? null)
        const sessionIds = [
          ...new Set([
            ...(registered?.sessionIds ?? []),
            ...(sessionRecords ?? [])
              .filter(record => WorkspaceSessionPath.includes({ sessionCwd: record.header.cwd, workspacePath: workspace.path }))
              .map(record => record.header.id),
          ]),
        ]
        const createdAt = registered?.createdAt
        const decision = WorkspaceCleanupModel.decide({
          thread: {
            name: workspace.name,
            unlandedCount: workspace.unlanded.length,
            rebasedAt: undefined,
            sessionIds,
            integrationQueued: deferredIntegrations.get(workspace.path) !== undefined,
            secondary: true,
            workingCopyState: sessionRecords === undefined ? 'unknown' : workspace.workingCopyState,
            usedAt: [changedAt.get(workspace.name), createdAt === undefined ? undefined : Date.parse(createdAt)],
          },
          archived,
          activity,
          now,
          olderThanMs: input.olderThanHours * HOUR_MS,
          kinds,
        })
        if (decision.action === 'skip') {
          skipped.push({ repoRoot: repository.repoRoot, name: workspace.name, reason: decision.reason })
          continue
        }
        workspaces.push({ repoRoot: repository.repoRoot, name: workspace.name, path: workspace.path, kind: decision.kind, lastUsedAt: decision.lastUsedAt })
      }
    }
    const entries = kinds.includes('untracked') ? await active.untrackedEntries(repository.repoRoot).catch(() => []) : []
    for (const entry of entries) {
      if (!WorkspaceCleanupModel.isStaleUntracked({ modifiedAt: entry.modifiedAt, now, olderThanMs: input.olderThanHours * HOUR_MS, kinds })) continue
      untracked.push({ repoRoot: repository.repoRoot, name: entry.name, path: entry.path, modifiedAt: entry.modifiedAt })
    }
    if (input.apply) continue
    const found = await active.danglingEmptyRevisions({ repoRoot: repository.repoRoot, abandon: false }).catch((error: unknown) => {
      hostContext?.logger.warn(
        'jj-integration: could not clear empty revisions in %s: %s',
        repository.repoRoot,
        error instanceof Error ? error.message : String(error),
      )
      return []
    })
    emptyRevisions.push(...found)
  }
  let selected = { workspaces, untracked }
  if (input.apply) {
    selected =
      input.targets === undefined ? filterCleanupTargets({ workspaces, untracked }) : filterCleanupTargets({ targets: input.targets, workspaces, untracked })
  }
  return { scopedRepoRoot, repoRoots, skipped, workspaces: selected.workspaces, workspaceIds, untracked: selected.untracked, emptyRevisions }
}

const previewCleanup = async (input: CleanupRequest): Promise<CleanupResult> => {
  const scan = await scanCleanup({ ...input, apply: false, trigger: 'manual' })
  return {
    applied: false,
    workspaces: scan.workspaces.map(row => ({ ...row, outcome: 'would-remove' })),
    skipped: scan.skipped,
    untracked: scan.untracked.map(row => ({ ...row, outcome: 'would-remove' })),
    emptyRevisions: scan.emptyRevisions,
  }
}

const applyCleanup = async (input: {
  readonly scan: CleanupScan
  readonly trigger: CleanupTrigger
  readonly report: Pick<CleanupJobReporter, 'beginPhase' | 'beginItem' | 'settleItem'>
}): Promise<CleanupResult> => {
  const scan = input.scan
  const report = input.report
  const active = requireThreads()
  const workspaces: CleanupResult['workspaces'] = []
  const untracked: CleanupResult['untracked'] = []
  const emptyRevisions: CleanupResult['emptyRevisions'] = []
  report.beginPhase('removing')
  const plannedByRepository = new Map<string, PlannedWorkspace[]>()
  for (const planned of scan.workspaces) {
    const group = plannedByRepository.get(planned.repoRoot) ?? []
    group.push(planned)
    plannedByRepository.set(planned.repoRoot, group)
  }
  for (const [repoRoot, plannedWorkspaces] of plannedByRepository) {
    for (const planned of plannedWorkspaces) report.beginItem(planned.name)
    const threadWorkspaces = plannedWorkspaces.filter(planned => planned.kind !== 'secondary')
    const secondaryWorkspaces = plannedWorkspaces.filter(planned => planned.kind === 'secondary')
    const threadOutcome =
      threadWorkspaces.length === 0
        ? { results: [] }
        : await active.discardMany({ repoRoot, names: threadWorkspaces.map(planned => planned.name), force: false })
    const secondaryOutcome =
      secondaryWorkspaces.length === 0
        ? { results: [] }
        : await active.discardSecondaryMany({
            repoRoot,
            workspaces: secondaryWorkspaces.map(planned => ({ name: planned.name, path: planned.path })),
          })
    const resultByName = new Map<string, { readonly status: string; readonly error: string | null }>()
    for (const result of threadOutcome.results) resultByName.set(result.name, { status: result.status, error: result.error })
    for (const result of secondaryOutcome.results) resultByName.set(result.name, { status: result.status, error: result.message })
    for (const planned of plannedWorkspaces) {
      const result = resultByName.get(planned.name)
      if (result?.status === 'discarded') {
        const workspaceId = scan.workspaceIds.get(planned.path)
        if (workspaceId !== null && workspaceId !== undefined) await registryOf().delete(WorkspaceId(workspaceId))
        for (const [sessionId, workspace] of isolatedSessionWorkspaces) {
          if (workspace.path === planned.path) isolatedSessionWorkspaces.delete(sessionId)
        }
        const correlationId = randomUUID()
        emitActivity({ type: 'workspace.discarded', summary: `Removed JJ workspace ${planned.name}`, path: planned.path, correlationId })
        if (planned.kind !== 'secondary') queueWorkspaceSync({ repoRoot, bookmark: readSettings().bookmark, correlationId })
        workspaces.push({ ...planned, outcome: 'removed' })
        report.settleItem('removed')
        continue
      }
      if (result?.status === 'has-work') {
        workspaces.push({ ...planned, outcome: 'has-work', ...(result.error !== null && { message: result.error }) })
        report.settleItem('kept')
        continue
      }
      workspaces.push({ ...planned, outcome: 'failed', message: result?.error ?? 'Workspace cleanup returned no result.' })
      report.settleItem('failed')
    }
  }
  for (const planned of scan.untracked) {
    report.beginItem(planned.name)
    try {
      await active.removeUntrackedEntry({ repoRoot: planned.repoRoot, name: planned.name })
      untracked.push({ ...planned, outcome: 'removed' })
      report.settleItem('removed')
    } catch (error) {
      untracked.push({ ...planned, outcome: 'failed', message: errorText(error) })
      report.settleItem('failed')
    }
  }
  report.beginPhase('abandoning')
  for (const repoRoot of scan.repoRoots) {
    const found = await active.danglingEmptyRevisions({ repoRoot, abandon: true }).catch((error: unknown) => {
      hostContext?.logger.warn('jj-integration: could not clear empty revisions in %s: %s', repoRoot, errorText(error))
      return []
    })
    emptyRevisions.push(...found)
  }
  invalidateRepositories()
  const result: CleanupResult = { applied: true, workspaces, skipped: scan.skipped, untracked, emptyRevisions }
  const removedCount = CleanupJobModel.removedCount(result)
  emitActivity({
    type: 'workspace.cleaned',
    summary: `${input.trigger === 'automatic' ? 'Automatic cleanup removed' : 'Cleaned up'} ${String(removedCount.workspaces)} workspace(s), ${String(removedCount.untracked)} untracked entr(ies) and ${String(emptyRevisions.length)} empty revision(s)`,
    detail: CleanupJobModel.skippedSummary(result),
    path: scan.scopedRepoRoot ?? null,
    level: input.trigger === 'automatic' && removedCount.workspaces + removedCount.untracked + emptyRevisions.length === 0 ? 'routine' : 'notable',
  })
  return result
}

const cleanupRunner = createCleanupJobRunner({
  execute: async ({ request, report }) => {
    const scanRequest = {
      path: request.path ?? undefined,
      olderThanHours: request.olderThanHours,
      kinds: request.kinds,
      apply: true as const,
      trigger: request.trigger,
    }
    const scan = await ('targets' in request && request.targets !== undefined
      ? scanCleanup({ ...scanRequest, targets: request.targets })
      : scanCleanup(scanRequest))
    report.planned(scan.workspaces.length + scan.untracked.length)
    return await applyCleanup({ scan, trigger: request.trigger, report })
  },
})

/** A finished run already reported itself as `workspace.cleaned`; only the runs that removed nothing by design or failed say so here. */
/** A registered workspace whose folder changed recently counts as activity for the repository it belongs to. */
const directoryModifiedAt = (path: string): number => {
  const stats = statSync(path, { throwIfNoEntry: false })
  if (stats === undefined) return 0
  return Math.max(stats.mtimeMs, stats.ctimeMs)
}

/** Bounded activity probe: directory mtimes only, never a Session list or a jj process per workspace. */
const activeRepositoryRoots = async (withinHours: number): Promise<readonly string[]> => {
  const active = requireThreads()
  const workspaces = presentWorkspaces(registryOf().list())
  const locations = await mapBounded(workspaces, LOCATE_CONCURRENCY, workspace => cachedBestEffortLocation(active, workspace.path))
  const lastUsedByRoot = new Map<string, number>()
  workspaces.forEach((workspace, index) => {
    const root = locations[index]?.repoRoot ?? workspace.path
    const registered = Date.parse(workspace.updatedAt)
    const lastUsed = Math.max(directoryModifiedAt(workspace.path), Number.isNaN(registered) ? 0 : registered)
    lastUsedByRoot.set(root, Math.max(lastUsedByRoot.get(root) ?? 0, lastUsed))
  })
  const since = Date.now() - withinHours * HOUR_MS
  return [...lastUsedByRoot].filter(([, lastUsed]) => lastUsed >= since).map(([root]) => root)
}

/** Every repository root the registry knows, so an automatic run can report the projects it skipped. */
const knownRepositoryRoots = async (): Promise<readonly string[]> => {
  const active = requireThreads()
  const workspaces = presentWorkspaces(registryOf().list())
  const locations = await mapBounded(workspaces, LOCATE_CONCURRENCY, workspace => cachedBestEffortLocation(active, workspace.path))
  return [...new Set(workspaces.map((workspace, index) => locations[index]?.repoRoot ?? workspace.path))]
}

const reportAutoCleanup = (outcome: AutoCleanupOutcome): void => {
  if (outcome.status === 'busy') {
    hostContext?.logger.debug('jj-integration: automatic cleanup skipped while %s runs', outcome.jobId)
    return
  }
  if (outcome.status === 'idle') {
    hostContext?.logger.debug('jj-integration: no repository changed in the last %s h; automatic cleanup idles', outcome.activeWithinHours)
    return
  }
  if (outcome.status === 'done') {
    hostContext?.logger.debug('jj-integration: automatic cleanup ran in %s repository(ies), skipped %s inactive one(s)', outcome.runs.length, outcome.inactive)
    return
  }
  if (outcome.status !== 'failed') return
  emitActivity({
    type: 'workspace.cleanup-failed',
    summary: 'Automatic thread-workspace cleanup failed',
    detail: outcome.message,
    path: null,
    level: 'attention',
  })
}

const startManualCleanup = (input: CleanupRequest) => {
  const scope = { path: input.path ?? null, olderThanHours: input.olderThanHours, kinds: [...input.kinds], trigger: 'manual' as const }
  if (input.targets === undefined) return cleanupRunner.start(scope)
  return cleanupRunner.start({ ...scope, targets: [...input.targets] })
}

const cleanupWorkspaces = async (input: CleanupRequest & { readonly apply: boolean }): Promise<CleanupResult> => {
  if (!input.apply) return await previewCleanup(input)
  const { done } = startManualCleanup(input)
  return await done
}

const sweepFinishedThreads = async (): Promise<void> => {
  const settings = readSettings()
  for (const repository of await listRepositories()) {
    for (const thread of repository.threads) {
      if (!thread.finished) continue
      if (!settings.removeFinishedThreads || thread.unlanded.length > 0) {
        await cleanKeptThread(thread.path)
        continue
      }
      if (
        !WorkspaceCleanupModel.isFinishedWorkspaceReadyToRemove({
          finished: thread.finished,
          unlandedCount: thread.unlanded.length,
          rebasedAt: thread.rebasedAt,
          now: Date.now(),
          graceMs: settings.removeFinishedThreadsAfterMinutes * 60_000,
        })
      )
        continue
      await discardThread({ path: thread.path, force: false }).catch(error => {
        hostContext?.logger.warn('jj-integration: could not remove finished thread %s: %s', thread.name, error instanceof Error ? error.message : String(error))
      })
    }
  }
}

/**
 * An archived thread kept for its unlanded work keeps its folder but not its dependencies: the project's cleanup
 * script (written once by memory, per project) deletes its node_modules, which setup reinstalls if it is reopened.
 */
const cleanKeptThread = async (path: string): Promise<void> => {
  if (hostContext === undefined || !existsSync(join(path, 'node_modules'))) return
  const memory = createHostApiClient(hostContext, workspaceScriptsApi, '@dshfiles/jj-integration')
  const scripts = await memory.scripts({ cwd: path }).catch((error: unknown) => {
    if (!(error instanceof Error && isApiOwnerMissing(error))) hostContext?.logger.warn('jj-integration: no cleanup script for %s: %s', path, String(error))
    return null
  })
  if (scripts === null) return
  await execFileAsync(scripts.cleanup, [path], { timeout: CLEANUP_TIMEOUT_MS }).catch((error: unknown) => {
    hostContext?.logger.warn('jj-integration: cleanup of archived thread %s failed: %s', path, error instanceof Error ? error.message : String(error))
  })
}

/** A deleted thread folder must not fail the next turn of a Session pinned to it: check the workspace out again first. */
const restoreMissingThreadWorkspace = async (path: string, sessionId: string): Promise<void> => {
  if (existsSync(join(path, '.jj'))) return
  const activeThreads = requireThreads()
  for (const workspace of registryOf().list()) {
    if (!existsSync(workspace.path) || threadsDirectory(workspace.path) !== dirname(path)) continue
    const location = await cachedBestEffortLocation(activeThreads, workspace.path)
    if (location === undefined || location.repoRoot !== location.workspaceRoot) continue
    await activeThreads.restore(location.repoRoot, path)
    const registry = registryOf()
    const registered = await registry.resolveByPath(path)
    if (registered === undefined) {
      const project = await registry.resolveByPath(location.repoRoot)
      await registry.create(path, `${project?.title ?? basename(location.repoRoot)} · ${basename(path)}`)
    }
    locationCache.delete(path)
    invalidateRepositories()
    emitActivity({ type: 'workspace.restored', summary: `Restored deleted thread workspace ${basename(path)}`, path, sessionId })
    return
  }
}

const threadPath = (input: { readonly path?: string | undefined }, caller: ApiCaller): string => {
  const isolatedPath = caller.kind === 'agent' && caller.sessionId !== undefined ? isolatedSessionWorkspaces.get(caller.sessionId)?.path : undefined
  const path = input.path ?? isolatedPath ?? (caller.kind === 'agent' ? caller.cwd : undefined)
  if (path === undefined) throw new PluginApiError('Pass the thread workspace path; this caller has no working directory.', { code: 'no-path' })
  return path
}

const isolateSession = async (caller: ApiCaller) => {
  if (caller.kind !== 'agent') throw new PluginApiError('Only an agent Session can isolate its working directory.', { code: 'agent-only' })
  if (caller.sessionId === undefined || caller.cwd === undefined) {
    throw new PluginApiError('This agent Session has no working directory to isolate.', { code: 'no-path' })
  }

  const existing = isolatedSessionWorkspaces.get(caller.sessionId)
  if (existing !== undefined) return { ...existing, created: false }

  let location: Awaited<ReturnType<Threads['locate']>>
  try {
    location = await requireThreads().locate(caller.cwd)
  } catch (error) {
    if (error instanceof ThreadError && error.code === 'not-a-repository') {
      throw new PluginApiError('Workspace isolation requires a Session inside a local jj repository.', { code: 'not-a-repository' })
    }
    throw error
  }

  if (location.threadName !== undefined) {
    const workspace = { name: location.threadName, path: location.workspaceRoot }
    isolatedSessionWorkspaces.set(caller.sessionId, workspace)
    return { ...workspace, created: false }
  }

  const activeThreads = requireThreads()
  const thread = await activeThreads.provision(location.repoRoot)
  const registry = registryOf()
  const project = await registry.resolveByPath(location.repoRoot)
  const registered = await registry.resolveByPath(thread.path)
  if (registered === undefined) await registry.create(thread.path, `${project?.title ?? basename(location.repoRoot)} · ${thread.name}`)

  isolatedSessionWorkspaces.set(caller.sessionId, thread)
  emitActivity({ type: 'workspace.provisioned', summary: `New thread workspace ${thread.name}`, path: thread.path })
  invalidateRepositories()
  return { ...thread, created: true }
}

const noDestination = (isolateByDefault: boolean): DestinationView => ({
  vcs: 'none',
  isolated: false,
  projectWorkspaceId: null,
  bookmark: null,
  bookmarks: [],
  isolateByDefault,
})

const destinationAt = async (workspaceRoot: string, isolated: boolean, projectWorkspaceId: string | null): Promise<DestinationView> => {
  const bookmarks = await requireThreads().bookmarks(workspaceRoot)
  return {
    vcs: 'jj',
    isolated,
    projectWorkspaceId,
    bookmark: bookmarks.current,
    bookmarks: [...bookmarks.names],
    isolateByDefault: isolatesNewThreadsByDefault(readSettings()),
  }
}

const api = jjIntegrationApi.host({
  ownWorkspaceFor: async ({ input }) => {
    const registry = registryOf()
    const source = registry.get(WorkspaceId(input.workspaceId))
    const unchanged = { workspaceId: input.workspaceId, branched: false }
    if (source === undefined || source.sessionIds.length === 0) return unchanged
    const location = await cachedBestEffortLocation(requireThreads(), source.path)
    if (location?.threadName === undefined) return unchanged
    const activeThreads = requireThreads()
    const thread = await activeThreads.provision(location.repoRoot, await activeThreads.branchPoint(location.workspaceRoot))
    const project = await registry.resolveByPath(location.repoRoot)
    const workspace = await registry.create(thread.path, `${project?.title ?? basename(location.repoRoot)} · ${thread.name}`)
    emitActivity({ type: 'workspace.provisioned', summary: `New thread workspace ${thread.name} branched from ${location.threadName}`, path: thread.path })
    invalidateRepositories()
    return { workspaceId: workspace.id, branched: true }
  },
  provision: async ({ input }) => {
    const registry = registryOf()
    const source = registry.get(WorkspaceId(input.workspaceId))
    if (source === undefined) throw new Error(`Unknown workspace ${input.workspaceId}.`)
    const settings = readSettings()
    const location = await cachedLocation(requireThreads(), source.path)
    if (location === undefined) return { workspaceId: source.id, isolated: false, destination: noDestination(isolatesNewThreadsByDefault(settings)) }
    const project = await registry.resolveByPath(location.repoRoot)
    if (!(input.isolate ?? isolatesNewThreadsByDefault(settings))) {
      const projectId = project?.id ?? source.id
      return { workspaceId: projectId, isolated: false, destination: await destinationAt(location.repoRoot, false, project?.id ?? null) }
    }
    const thread = await requireThreads().provision(location.repoRoot, input.base, input.name)
    const workspace = await registry.create(thread.path, `${project?.title ?? basename(location.repoRoot)} · ${thread.name}`)
    emitActivity({ type: 'workspace.provisioned', summary: `New thread workspace ${thread.name}`, path: thread.path })
    invalidateRepositories()
    return { workspaceId: workspace.id, isolated: true, destination: await destinationAt(thread.path, true, project?.id ?? null) }
  },
  isolate: ({ caller }) => isolateSession(caller),
  destination: async ({ input }) => {
    const registry = registryOf()
    const source = registry.get(WorkspaceId(input.workspaceId))
    if (source === undefined) {
      throw new PluginApiError('The workspace destination is unknown. Refresh and retry.', { code: 'workspace-not-found' })
    }
    const ownedByAnotherSession =
      input.sessionId === undefined ? undefined : workspaceHasOtherSession({ sessionId: input.sessionId, workspaceSessionIds: source.sessionIds })
    const location = await cachedLocation(requireThreads(), source.path)
    if (location === undefined) {
      const destination = noDestination(isolatesNewThreadsByDefault(readSettings()))
      if (ownedByAnotherSession === undefined) return destination
      return { ...destination, ownedByAnotherSession }
    }
    const [project, located] = await Promise.all([
      registry.resolveByPath(location.repoRoot),
      destinationAt(location.workspaceRoot, location.threadName !== undefined, null),
    ])
    // A new thread that will isolate on its first send finds its workspace already checked out.
    if (location.threadName === undefined && located.isolateByDefault) requireThreads().prewarm(location.repoRoot)
    const destination = { ...located, projectWorkspaceId: project?.id ?? null }
    if (ownedByAnotherSession === undefined) return destination
    return { ...destination, ownedByAnotherSession }
  },
  classifyWorkspaces: async ({ input }) => {
    const registry = registryOf()
    const active = requireThreads()
    const jjWorkspaceIds: string[] = []
    for (const workspaceId of new Set(input.workspaceIds)) {
      const workspace = registry.get(WorkspaceId(workspaceId))
      if (workspace === undefined || !existsSync(workspace.path)) continue
      const location = await active.locate(workspace.path).catch(() => undefined)
      if (location !== undefined && ThreadWorkspaceModel.isSecondaryWorkspace(location)) jjWorkspaceIds.push(workspaceId)
    }
    return { jjWorkspaceIds }
  },
  projects: async () => {
    const workspaces = [...registryOf().list()].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    const registered = await registeredProjects({
      workspaces: workspaces.map(workspace => ({ workspaceId: workspace.id, title: workspace.title, path: workspace.path })),
      classify: async path => {
        if (!existsSync(path)) return 'missing'
        const location = await cachedBestEffortLocation(requireThreads(), path)
        return location !== undefined && ThreadWorkspaceModel.isSecondaryWorkspace(location) ? 'workspace' : 'project'
      },
    })
    return { projects: [...registered.projects], workspaces: [...registered.workspaces] }
  },
  noFolder: async () => {
    const registry = registryOf()
    const directory = join(homedir(), '.dsh', 'no-folder')
    await mkdir(directory, { recursive: true })
    const existing = await registry.resolveByPath(directory)
    return { workspaceId: (existing ?? (await registry.create(directory, 'No folder'))).id }
  },
  repositories: async () => listRepositorySnapshot(),
  refreshRepositories: async () => ({ started: repositoryViewsCache.startRefresh() }),
  threadAt: async ({ input }) => {
    const location = await requireThreads()
      .locate(input.path)
      .catch(() => undefined)
    const found = location === undefined ? undefined : await findThread({ location, includeActivity: false, viewerSessionId: input.sessionId })
    return { thread: found?.thread ?? null }
  },
  revisionGraph: async ({ input }) => ({ graph: await requireThreads().revisionGraph(input.path) }),
  land: ({ input }) => landThread({ path: input.path, sessionId: input.sessionId, fromAgent: false }),
  queueLand: ({ input }) => queueIntegration({ path: input.path, sessionId: input.sessionId }),
  cancelQueuedLand: ({ input }) => cancelQueuedIntegration(input.path),
  integrationProgress: ({ input }) => ({ progress: readIntegrationProgress(input.path) }),
  threadStatus: async ({ input, caller }) => {
    const location = await requireThreads().locate(threadPath(input, caller))
    const found = await findThread({
      location,
      caller: caller.kind === 'agent' ? { fromAgent: true, sessionId: caller.sessionId } : { fromAgent: false, sessionId: undefined },
    })
    return { bookmark: readSettings().bookmark, thread: found?.thread ?? null }
  },
  landThread: async ({ input, caller }) => {
    const location = await requireThreads().locate(threadPath(input, caller))
    if (location.threadName === undefined) return { summary: 'This Session does not run in a thread workspace; nothing to rebase.', result: null }
    const result = await landThread({
      path: location.workspaceRoot,
      sessionId: caller.kind === 'agent' ? caller.sessionId : undefined,
      fromAgent: caller.kind === 'agent',
    })
    return { summary: landingMessage(result) ?? JSON.stringify(result), result }
  },
  workspaceSync: () => ({ sync: workspaceSync }),
  discard: ({ input }) => discardThread(input),
  discardMany: ({ input }) => discardThreads(input),
  cleanupWorkspaces: ({ input }) => {
    const { targets, ...request } = input
    if (targets === undefined) return cleanupWorkspaces(request)
    return cleanupWorkspaces({ ...request, targets })
  },
  startCleanup: ({ input }) => {
    const { job, done } = startManualCleanup(input)
    // The job owns the removal once queued; its failure is reported on the trail, not to a request that already returned.
    void done.catch(() => undefined)
    return { job }
  },
  cleanupJobs: () => ({ jobs: [...cleanupRunner.trail()] }),
})

const rebaseCommand = defineCommand({
  name: 'rebase',
  description: 'Rebase this thread workspace onto the configured bookmark.',
  handler: async (invocation: CommandInvocation): Promise<CommandResult> => {
    if (invocation.rawInput.trim().length > 0) return { kind: 'error', text: 'Usage: /rebase' }
    if (hostContext === undefined) return { kind: 'error', text: 'jj-integration is not active.' }
    const controller = hostContext.get('sessionController')
    if (controller === undefined) return { kind: 'error', text: 'The Session controller is unavailable.' }
    const sessions = await controller.list({ projections: [] }, invocation.signal)
    const path = sessions.items.find(session => session.sessionId === invocation.agent.id)?.cwd
    if (path === undefined || path.length === 0) return { kind: 'error', text: 'This Session has no working directory; there is nothing to rebase.' }
    const location = await requireThreads().locate(path)
    if (location.threadName === undefined) {
      return { kind: 'error', text: 'This Session is not in a managed thread workspace. Use an isolated thread workspace to run /rebase.' }
    }
    const result = await landThread({
      path: location.workspaceRoot,
      sessionId: invocation.agent.id,
      fromAgent: false,
      signal: invocation.signal,
    })
    if (result.status === 'landed') return { kind: 'success', text: `Integrated ${String(result.revisions.length)} revision(s) into ${result.bookmark}.` }
    if (result.status === 'nothing-to-land') return { kind: 'success', text: `Nothing to integrate; the workspace now sits on ${result.bookmark}.` }
    if (result.status === 'needs-description') {
      return {
        kind: 'error',
        text: `Rebase refused: ${String(result.revisions.length)} revision(s) need real descriptions. Describe them and run /rebase again.`,
      }
    }
    const agentAsked = result.agentAsked ? " The thread's agent was asked to fix them and rebase again." : ''
    return {
      kind: 'error',
      text: `Rebase onto ${result.bookmark} stopped with conflicts in ${String(result.files.length)} file(s). Resolve them in the thread workspace and run /rebase again.${agentAsked}`,
    }
  },
})

const ownedSettings = jjIntegrationSettings.host({
  setup: scope => {
    settingsScope = scope
    return () => {
      if (settingsScope === scope) settingsScope = undefined
    }
  },
})

const setupHost = (context: Context): Effect<void> => {
  hostContext = context
  threads = createThreads({ executor: createExecutor(context), bookmark: () => readSettings().bookmark, threadsDirectory })
  const projectChecks = createHostApiClient(context, projectChecksApi, '@dshfiles/jj-integration')
  const handleVerifiedTurn = async (verifiedTurn: ProjectChecksVerifiedTurn): Promise<void> => {
    if (verifiedTurn.signal.aborted) return

    const registry = registryOf()
    const sessionWorkspaces = [...registry.list()].filter(workspace => workspace.sessionIds.includes(verifiedTurn.sessionId))
    const workspace = sessionWorkspaces[0]
    if (sessionWorkspaces.length !== 1 || workspace === undefined) return

    const activeThreads = requireThreads()
    const initialLocation = await activeThreads.locate(workspace.path, verifiedTurn.signal).catch(() => undefined)
    const autoIntegrationSettings = readSettings()
    if (
      initialLocation === undefined ||
      !mayAutoIntegrateWorkspace({
        scope: autoIntegrationSettings.autoIntegrationScope,
        isThreadWorkspace: initialLocation.threadName !== undefined,
        sessionId: verifiedTurn.sessionId,
        sessionIds: workspace.sessionIds,
        repositoryRoot: initialLocation.repoRoot,
        excludedRepositoryRoots: autoIntegrationSettings.autoIntegrationExcludedRepositories,
      })
    ) {
      return
    }

    const correlationId = randomUUID()
    const report = (
      state: AutoIntegrationActivityState,
      summary: string,
      level: ActivityLevel = 'notable',
      detail = `Turn ${String(verifiedTurn.turn)}`,
    ): void =>
      emitActivity({
        type: `workspace.auto_integration_${state}`,
        summary,
        detail,
        path: workspace.path,
        sessionId: verifiedTurn.sessionId,
        correlationId,
        level,
      })

    report('queued', `Queued automatic integration for ${basename(workspace.path)}`)
    const bookmark = readSettings().bookmark
    let repoRoot: string | undefined
    let outcome: Awaited<ReturnType<Threads['landVerified']>>
    try {
      outcome = await activeThreads.landVerified({
        path: workspace.path,
        bookmark,
        signal: verifiedTurn.signal,
        sessionId: verifiedTurn.sessionId,
        expectedSourceRevision: verifiedTurn.sourceRevision,
        authorize: async location => {
          const current = await registry.resolveByPath(location.workspaceRoot)
          const currentSettings = readSettings()
          if (
            current === undefined ||
            current.path !== workspace.path ||
            !mayAutoIntegrateWorkspace({
              scope: currentSettings.autoIntegrationScope,
              isThreadWorkspace: location.threadName !== undefined,
              sessionId: verifiedTurn.sessionId,
              sessionIds: current.sessionIds,
              repositoryRoot: location.repoRoot,
              excludedRepositoryRoots: currentSettings.autoIntegrationExcludedRepositories,
            })
          ) {
            return false
          }
          const authorization = await projectChecks.safe.assertVerifiedCompletion(
            {
              sessionId: verifiedTurn.sessionId,
              turn: verifiedTurn.turn,
              sourceRevision: verifiedTurn.sourceRevision,
            },
            { signal: verifiedTurn.signal },
          )
          if (!authorization.ok || authorization.value.status !== 'authorized') return false
          repoRoot = location.repoRoot
          return true
        },
        verifyCandidate: async candidate => {
          const result = await projectChecks.safe.verifyCandidate(
            {
              sessionId: verifiedTurn.sessionId,
              turn: verifiedTurn.turn,
              sourceRevision: verifiedTurn.sourceRevision,
              expectedRevision: candidate.workingCopyCommitId,
            },
            { signal: verifiedTurn.signal },
          )
          if (!result.ok) {
            const message = isApiOwnerMissing(result.error)
              ? 'Project Checks became unavailable during automatic integration. The bookmark was not advanced; retry when it is available.'
              : 'Project Checks could not verify the rebased candidate. The bookmark was not advanced; retry or integrate manually.'
            return { status: 'failed', message }
          }
          if (result.value.status === 'passed') return { status: 'passed' }
          if (result.value.status === 'cancelled' || verifiedTurn.signal.aborted) return { status: 'cancelled' }
          if (result.value.status === 'unavailable' && result.value.prompt === null) return { status: 'cancelled' }
          const message = result.value.prompt ?? 'Project Checks did not verify the rebased candidate. The bookmark was not advanced.'
          return result.value.status === 'stale' ? { status: 'stale', message } : { status: 'failed', message }
        },
      })
    } catch (error) {
      if (verifiedTurn.signal.aborted) {
        report('cancelled', 'Automatic integration was cancelled.', 'routine')
        return
      }
      if (error instanceof ThreadError && error.code === 'not-a-thread') {
        report('skipped', 'Automatic integration skipped a shared or unmanaged workspace.', 'routine')
        return
      }
      verifiedTurn.requestAgentFix(
        'Automatic integration could not safely rebase this thread. The main bookmark was not advanced; resolve the issue and stop again, or integrate manually.',
      )
      report('failed', 'Automatic integration stopped before advancing the bookmark.', 'attention')
      return
    }

    const bookmarkLabel = safePromptField(bookmark, 128)
    if (outcome.status === 'landed') {
      if (repoRoot !== undefined) {
        queueWorkspaceSync({ repoRoot, bookmark, revision: outcome.head.commitId, sessionId: verifiedTurn.sessionId, correlationId })
      }
      report('landed', `Automatically rebased ${String(outcome.revisions.length)} revision(s) onto ${bookmarkLabel}.`)
      return
    }
    if (outcome.status === 'nothing-to-land') {
      report('nothing-to-land', 'Automatic integration found no remaining work.', 'routine')
      return
    }
    if (outcome.status === 'already-integrated') {
      report('already-integrated', `All remaining revisions already match patches in ${bookmarkLabel}. No rebase or bookmark change was made.`, 'routine')
      return
    }
    if (outcome.status === 'patch-equivalent-work') {
      const revisions = outcome.revisions.map(revision => `- ${safePromptField(revision.changeId, 64)} (${revision.commitId.slice(0, 12)})`)
      verifiedTurn.requestAgentFix(
        [
          'Automatic integration found revisions with exact patch matches in target history:',
          ...revisions,
          'Do not rebase this mixed branch automatically. Separate represented revisions from unique work, then stop for Project Checks again. The bookmark was not changed.',
        ].join('\n'),
      )
      report('patch-equivalent-work', 'Automatic integration paused to avoid replaying represented patches.', 'attention')
      return
    }
    if (outcome.status === 'patch-equivalence-unavailable') {
      const revisions = outcome.revisions.map(revision => `- ${safePromptField(revision.changeId, 64)} (${revision.commitId.slice(0, 12)})`)
      verifiedTurn.requestAgentFix(
        [
          'Automatic integration could not safely compare these revision patches:',
          ...revisions,
          'Inspect the patches and target history manually. No rebase or bookmark change was made; stop for Project Checks again only after resolving the uncertainty.',
        ].join('\n'),
      )
      report('patch-equivalence-unavailable', 'Automatic integration paused because patch equivalence could not be proven.', 'attention')
      return
    }
    if (outcome.status === 'detached-work') {
      const revisions = outcome.revisions.map(revision => `- ${safePromptField(revision.changeId, 64)} (${revision.commitId.slice(0, 12)})`)
      verifiedTurn.requestAgentFix(
        [
          'Automatic integration stopped because this thread has detached revisions that are not covered by the current completion checks:',
          ...revisions,
          'Inspect and reattach only the intended work into this thread’s active working copy, then stop for Project Checks again. Do not advance the bookmark or discard these revisions directly.',
        ].join('\n'),
      )
      report(
        'detached-work',
        'Automatic integration paused for detached revisions.',
        'attention',
        `${String(outcome.revisions.length)} detached revision(s) · turn ${String(verifiedTurn.turn)}`,
      )
      return
    }
    if (outcome.status === 'conflicted') {
      const files = outcome.files.map(file => safePromptField(file, 240))
      verifiedTurn.requestAgentFix(
        [
          `Automatic integration onto \`${bookmarkLabel}\` stopped with conflicts in:`,
          ...files.map(file => `- ${file}`),
          'Resolve them in this dedicated workspace and keep each revision described. The bookmark was not advanced; after Project Checks pass again, the queue will retry against the latest bookmark.',
        ].join('\n'),
      )
      report(
        'conflicted',
        'Automatic integration stopped on rebase conflicts.',
        'attention',
        `${String(files.length)} conflicted file(s) · turn ${String(verifiedTurn.turn)}`,
      )
      return
    }
    if (outcome.status === 'needs-description') {
      verifiedTurn.requestAgentFix(
        [
          `Automatic integration onto \`${bookmarkLabel}\` stopped because these revisions have no real description:`,
          ...outcome.revisions.map(revision => `- ${safePromptField(revision.changeId, 64)}`),
          'Describe each revision with `jj describe -r <change-id> -m "<conventional commit message>"`. The bookmark was not advanced; after Project Checks pass again, the queue will retry.',
        ].join('\n'),
      )
      report(
        'needs-description',
        'Automatic integration stopped on undescribed revisions.',
        'attention',
        `${String(outcome.revisions.length)} revision(s) · turn ${String(verifiedTurn.turn)}`,
      )
      return
    }
    if (outcome.status === 'verification-failed' || outcome.status === 'verification-stale') {
      verifiedTurn.requestAgentFix(outcome.message)
      report('verification-failed', 'Project Checks did not verify the rebased candidate; the bookmark was not advanced.', 'attention')
      return
    }
    if (outcome.status === 'verification-cancelled') {
      report('cancelled', 'Automatic integration was cancelled before the bookmark moved.', 'routine')
      return
    }
    report('skipped', 'Automatic integration skipped because workspace ownership or completion verification could not be revalidated.', 'routine')
  }
  context.on('dshfiles/project-checks/verified', handleVerifiedTurn)
  // Prepended so it runs before DSH's working-directory check, which fails the turn when the Session's folder is gone.
  context.on(
    'system-prompt/assemble',
    async (_assembly, promptContext, next) => {
      const agent = promptContext.agent
      if (agent === undefined) return next()
      const directories = new Set([context.get('workingDirectory')?.get(agent.session), agent.session.header.cwd])
      for (const directory of directories) {
        if (directory === undefined || directory === null) continue
        await restoreMissingThreadWorkspace(directory, agent.session.id).catch(error =>
          context.logger.warn('jj-integration: could not restore thread workspace %s: %o', directory, error),
        )
      }
      return next()
    },
    { prepend: true },
  )
  // The Turn tail asks for this workspace's status the moment its Turn ends; the tool results that describe the work
  // arrive before that, so the same read lands in the jj view cache and the offer no longer waits for a cold read.
  const statusWarmup = new ThreadStatusWarmup({
    read: async path => {
      const location = await cachedBestEffortLocation(requireThreads(), path)
      if (location?.threadName === undefined) return
      await requireThreads().status(location.repoRoot, location.threadName)
    },
    report: error => context.logger.warn('jj-integration: warming a thread status failed: %o', error),
  })
  context.on('session/event', (session, event) => {
    const queued = deferredIntegrations.paths()
    if (queued.length > 0) {
      const touchesQueuedThread = [...registryOf().list()].some(workspace => queued.includes(workspace.path) && workspace.sessionIds.includes(session.id))
      if (touchesQueuedThread || queued.some(path => isolatedSessionIdsAt(path).includes(String(session.id))))
        wakeDeferredIntegrations(DEFERRED_INTEGRATION_SETTLE_MS)
    }
    // Only events that can follow a jj write warm the status; a streaming prediction token would read for nothing.
    if (event.type !== 'tool/result' && event.type !== 'assistant/message' && event.type !== 'turn/end') return
    const cwd = session.header.cwd
    if (cwd !== undefined && cwd.length > 0) statusWarmup.schedule(cwd)
  })
  const deferredFallback = setInterval(() => {
    if (deferredIntegrations.paths().length > 0) wakeDeferredIntegrations(0)
  }, DEFERRED_INTEGRATION_FALLBACK_MS)
  deferredFallback.unref()
  const sweep = (): void => {
    void sweepFinishedThreads().catch(error => context.logger.warn('jj-integration: thread sweep failed: %o', error))
  }
  const autoCleanup = createAutoCleanupScheduler({
    runner: cleanupRunner,
    settings: () => readSettings().autoCleanup,
    report: reportAutoCleanup,
    activeProjects: activeRepositoryRoots,
    knownProjects: knownRepositoryRoots,
    onError: error => context.logger.warn('jj-integration: automatic cleanup run failed: %o', error),
  })
  const firstSweep = setTimeout(sweep, 30_000)
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS)
  firstSweep.unref()
  timer.unref()
  return {
    async *[Symbol.asyncIterator]() {
      yield async () => {
        autoCleanup.dispose()
        statusWarmup.dispose()
        clearTimeout(firstSweep)
        clearInterval(timer)
        clearInterval(deferredFallback)
        if (deferredIntegrationWake !== undefined) clearTimeout(deferredIntegrationWake)
        if (hostContext === context) {
          hostContext = undefined
          threads = undefined
          deferredIntegrations.clear()
          locationCache.clear()
          invalidateRepositories()
        }
      }
    },
  }
}

export default defineHost({
  name: 'jj-integration',
  inject: ['subprocess', 'sessionController'],
  commands: [rebaseCommand],
  settings: [ownedSettings],
  apis: [api],
  setup: setupHost,
})
