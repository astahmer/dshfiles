import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { Context, Effect } from '@deepseek-ai/cordis'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-subprocess'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId, type Workspace } from '@deepseek-ai/dsh-workspace'
import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'
import { z } from 'zod'
import { jjIntegrationApi, type DestinationView, type LandResult, type RepositoryView, type ThreadView, type WorkspaceSyncView } from './api.js'
import { jjIntegrationSettings, type JjIntegrationSettings } from './settings.js'
import { canRebaseThread, hasPendingUserQuestion, type ThreadSessionActivity } from './thread-rebase-eligibility.js'
import { checkoutSyncArgv, createThreads, defaultThreadsDirectory, type JjExecutor, type ThreadStatus, type Threads } from './threads.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshfiles/activity/event'(payload: unknown): void
  }
}

const MAX_OUTPUT = 512 * 1024
const MAX_STDERR = 64 * 1024
const JJ_TIMEOUT_MS = 120_000
const SETUP_TIMEOUT_MS = 15 * 60_000
/** A thread younger than this may still be waiting for its first Session to attach. */
const SWEEP_GRACE_MS = 15 * 60_000
const SWEEP_INTERVAL_MS = 10 * 60_000
/** Installs and plugin rebuilds after a large rebase take minutes. */
const SYNC_TIMEOUT_MS = 30 * 60_000

const defaultSettings: JjIntegrationSettings = jjIntegrationSettings.schema({})
let settingsScope: SettingsScope<JjIntegrationSettings> | undefined
let hostContext: Context | undefined
let threads: Threads | undefined
let workspaceSync: WorkspaceSyncView | null = null
let workspaceSyncQueued = false
let workspaceSyncQueue: Promise<void> = Promise.resolve()

const readSettings = (): JjIntegrationSettings => {
  try {
    return settingsScope?.get() ?? defaultSettings
  } catch {
    return defaultSettings
  }
}

const threadsDirectory = (repoRoot: string): string => {
  const configured = readSettings().threadsDirectory.trim()
  if (configured === '') return defaultThreadsDirectory(repoRoot)
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

const emitActivity = (input: {
  readonly type: string
  readonly summary: string
  readonly detail?: string
  readonly path: string
  readonly level?: string
}): void => {
  const at = Date.now()
  hostContext?.emit('dshfiles/activity/event', {
    kind: 'workspace',
    value: {
      id: `workspace:${input.type}:${input.path}:${String(at)}`,
      at,
      type: input.type,
      level: input.level ?? 'notable',
      summary: input.summary,
      detail: input.detail ?? null,
      sessionId: null,
      workspaceId: input.path,
      workspaceName: basename(input.path),
    },
  })
}

const createExecutor =
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
    return {
      exitCode: outcome.exitCode ?? 1,
      stdout: handle.collected.stdout?.readFrom(0)?.text ?? '',
      stderr: handle.collected.stderr?.readFrom(0)?.text ?? '',
    }
  }

/** Operator-configured setup (dependency install and the like); it never blocks the thread from opening. */
const runSetupCommand = async (context: Context, command: string, cwd: string): Promise<void> => {
  const argv = process.platform === 'win32' ? ['cmd.exe', '/c', command] : ['/bin/sh', '-c', command]
  const handle = context.subprocess.spawn({
    argv,
    cwd,
    stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_STDERR }, stderr: { maxBytes: MAX_STDERR } },
    graceMs: 5_000,
    signal: AbortSignal.timeout(SETUP_TIMEOUT_MS),
  })
  const outcome = await handle.done
  const failed = outcome.exitCode !== 0
  emitActivity({
    type: failed ? 'workspace.setup_failed' : 'workspace.setup_done',
    level: failed ? 'attention' : 'routine',
    summary: failed ? `Thread setup failed in ${basename(cwd)}` : `Thread setup finished in ${basename(cwd)}`,
    detail: (handle.collected.stderr?.readFrom(0)?.text ?? '').slice(-2_000),
    path: cwd,
  })
}

const isFinished = (workspace: Workspace | undefined, archived: ReadonlySet<string>): boolean =>
  workspace === undefined || workspace.sessionIds.every(sessionId => archived.has(sessionId))

const readSessionActivity = async (): Promise<ReadonlyMap<string, ThreadSessionActivity> | undefined> => {
  const controller = requireContext().get('sessionController')
  if (controller === undefined) return undefined
  try {
    const result = await controller.list({}, AbortSignal.timeout(15_000))
    const activity = new Map<string, ThreadSessionActivity>()
    for (const item of result.items) {
      activity.set(item.sessionId, {
        running: item.running,
        pendingUserQuestion: hasPendingUserQuestion(item.projections?.values),
      })
    }
    return activity
  } catch {
    return undefined
  }
}

const canRebaseWorkspace = (sessionIds: readonly string[], activity: ReadonlyMap<string, ThreadSessionActivity> | undefined): boolean =>
  canRebaseThread(sessionIds, sessionId => activity?.get(sessionId))

const threadView = (
  status: ThreadStatus,
  workspace: Workspace | undefined,
  archived: ReadonlySet<string>,
  activity: ReadonlyMap<string, ThreadSessionActivity> | undefined,
): ThreadView => {
  const sessionIds = [...(workspace?.sessionIds ?? [])]
  return {
    name: status.name,
    path: status.path,
    workspaceId: workspace?.id ?? null,
    sessionIds,
    finished: isFinished(workspace, archived),
    canRebase: canRebaseWorkspace(sessionIds, activity),
    missing: status.missing,
    behind: status.behind,
    unlanded: [...status.unlanded],
  }
}

/** Every registered project that is the owning checkout of a jj repository, with its thread workspaces. */
const listRepositories = async (): Promise<readonly RepositoryView[]> => {
  const registry = registryOf()
  const active = requireThreads()
  const workspaces = registry.list()
  const byPath = new Map(workspaces.map(workspace => [workspace.path, workspace]))
  const archived = new Set<string>(registry.archivedSessionIds)
  const activity = await readSessionActivity()
  const repositories = new Map<string, RepositoryView>()
  for (const workspace of workspaces) {
    if (!existsSync(workspace.path)) continue
    const location = await active.locate(workspace.path).catch(() => undefined)
    if (location === undefined || repositories.has(location.repoRoot)) continue
    const owner = byPath.get(location.repoRoot)
    const statuses = await active.list(location.repoRoot)
    repositories.set(location.repoRoot, {
      repoRoot: location.repoRoot,
      title: owner?.title ?? basename(location.repoRoot),
      workspaceId: owner?.id ?? null,
      threads: statuses.map(status => threadView(status, byPath.get(status.path), archived, activity)),
    })
  }
  return [...repositories.values()]
}

const findThread = async (path: string): Promise<{ readonly repository: RepositoryView; readonly thread: ThreadView } | undefined> => {
  for (const repository of await listRepositories()) {
    const thread = repository.threads.find(candidate => candidate.path === path)
    if (thread !== undefined) return { repository, thread }
  }
  return undefined
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
  // SessionRequestId is a type-only brand over a client-minted unique id.
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

const describeWorkspaceSync = (view: WorkspaceSyncView): string => {
  if (view.status === 'up-to-date') return `${view.workspace} already on ${view.bookmark}`
  if (view.status !== 'synced') return `${view.workspace} not updated: ${view.message ?? view.status ?? 'unknown error'}`
  const rebuilt = view.pluginsRebuilt.length
  if (rebuilt === 0 && !view.restartNeeded) return `${view.workspace} updated · nothing to rebuild`
  return `${view.workspace} updated · ${String(rebuilt)} plugin${rebuilt === 1 ? '' : 's'} rebuilt · ${view.restartNeeded ? 'restart to apply' : 'applied live'}`
}

interface WorkspaceSyncInput {
  readonly repoRoot: string
  readonly workspace: string
  readonly bookmark: string
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

const runWorkspaceSync = async (input: WorkspaceSyncInput): Promise<WorkspaceSyncView> => {
  const failed = (message: string): WorkspaceSyncView => workspaceSyncView(input, 'failed', message)
  let argv: readonly string[]
  try {
    argv = checkoutSyncArgv(input)
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
  let decoded: unknown
  try {
    decoded = JSON.parse(stdout)
  } catch {
    return failed(`dshx checkout sync printed no result: ${(handle.collected.stderr?.readFrom(0)?.text ?? '').trim().slice(-400)}`)
  }
  const output = checkoutSyncOutputSchema.safeParse(decoded)
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

/** Runs one sync at a time; rebases arriving while one waits share it. */
const queueWorkspaceSync = (repoRoot: string): void => {
  const settings = readSettings()
  const workspace = settings.syncWorkspaceAfterLand.trim()
  if (workspace === '' || workspaceSyncQueued) return
  workspaceSyncQueued = true
  const input = { repoRoot, workspace, bookmark: settings.bookmark }
  workspaceSync = workspaceSyncView(input, 'running', null)
  workspaceSyncQueue = workspaceSyncQueue.then(async () => {
    workspaceSyncQueued = false
    const view = await runWorkspaceSync(input).catch(error => workspaceSyncView(input, 'failed', error instanceof Error ? error.message : String(error)))
    workspaceSync = view
    emitActivity({
      type: `workspace.sync_${view.state}`,
      level: view.state === 'failed' || view.restartNeeded ? 'attention' : 'notable',
      summary: describeWorkspaceSync(view),
      detail: view.message ?? undefined,
      path: repoRoot,
    })
  })
}

const landThread = async (input: { readonly path: string; readonly sessionId: string | undefined; readonly fromAgent: boolean }): Promise<LandResult> => {
  const bookmark = readSettings().bookmark
  const location = await requireThreads().locate(input.path)
  if (location.threadName !== undefined) {
    const registry = registryOf()
    const workspace = await registry.resolveByPath(location.workspaceRoot)
    if (workspace === undefined) throw new PluginApiError('Could not verify thread activity before rebasing.', { code: 'thread-activity-unknown' })
    const activity = await readSessionActivity()
    if (!canRebaseWorkspace(workspace.sessionIds, activity)) {
      throw new PluginApiError('Finish all work and answer pending questions before rebasing this thread.', { code: 'thread-active' })
    }
  }
  const outcome = await requireThreads().land(input.path)
  const result: LandResult = {
    status: outcome.status,
    revisions: outcome.status === 'nothing-to-land' ? [] : [...outcome.revisions],
    files: outcome.status === 'conflicted' ? [...outcome.files] : [],
    bookmark,
    ...(outcome.status === 'landed' && outcome.head !== undefined ? { head: outcome.head } : {}),
    agentAsked: false,
  }
  const message = landingMessage(result)
  const agentAsked =
    message !== undefined && !input.fromAgent && readSettings().askAgentToFixLanding
      ? await askAgent(input.path, input.sessionId, message).catch(() => false)
      : false
  if (outcome.status === 'landed') queueWorkspaceSync((await requireThreads().locate(input.path)).repoRoot)
  emitActivity({
    type: `workspace.rebase_${outcome.status.replaceAll('-', '_')}`,
    level: outcome.status === 'landed' || outcome.status === 'nothing-to-land' ? 'notable' : 'attention',
    summary:
      outcome.status === 'landed'
        ? `Rebased ${String(outcome.revisions.length)} revision(s) from ${basename(input.path)} onto ${bookmark}`
        : `Rebase ${outcome.status} in ${basename(input.path)}`,
    path: input.path,
  })
  return { ...result, agentAsked }
}

const discardThread = async (input: { readonly path: string; readonly force: boolean }) => {
  const found = await findThread(input.path)
  if (found === undefined) throw new Error(`${input.path} is not a thread workspace.`)
  const outcome = await requireThreads().discard({ repoRoot: found.repository.repoRoot, name: found.thread.name, force: input.force })
  if (outcome.status === 'discarded') {
    if (found.thread.workspaceId !== null) await registryOf().delete(WorkspaceId(found.thread.workspaceId))
    emitActivity({ type: 'workspace.discarded', summary: `Removed thread workspace ${found.thread.name}`, path: input.path })
  }
  return { status: outcome.status, revisions: outcome.status === 'has-work' ? [...outcome.revisions] : [] }
}

const sweepFinishedThreads = async (): Promise<void> => {
  if (!readSettings().removeFinishedThreads) return
  for (const repository of await listRepositories()) {
    for (const thread of repository.threads) {
      if (!thread.finished || thread.unlanded.length > 0) continue
      const createdAt = thread.workspaceId === null ? undefined : registryOf().get(WorkspaceId(thread.workspaceId))?.createdAt
      const bornAt = createdAt === undefined ? (existsSync(thread.path) ? statSync(thread.path).mtimeMs : 0) : Date.parse(createdAt)
      if (Date.now() - bornAt < SWEEP_GRACE_MS) continue
      await discardThread({ path: thread.path, force: false }).catch(error => {
        hostContext?.logger.warn('jj-integration: could not remove finished thread %s: %s', thread.name, error instanceof Error ? error.message : String(error))
      })
    }
  }
}

const threadPath = (input: { readonly path?: string | undefined }, caller: ApiCaller): string => {
  const path = input.path ?? (caller.kind === 'agent' ? caller.cwd : undefined)
  if (path === undefined) throw new PluginApiError('Pass the thread workspace path; this caller has no working directory.', { code: 'no-path' })
  return path
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
    isolateByDefault: readSettings().isolateByDefault,
  }
}

const api = jjIntegrationApi.host({
  provision: async ({ input }) => {
    const registry = registryOf()
    const source = registry.get(WorkspaceId(input.workspaceId))
    if (source === undefined) throw new Error(`Unknown workspace ${input.workspaceId}.`)
    const settings = readSettings()
    const location = await requireThreads()
      .locate(source.path)
      .catch(() => undefined)
    if (location === undefined) return { workspaceId: source.id, isolated: false, destination: noDestination(settings.isolateByDefault) }
    const project = await registry.resolveByPath(location.repoRoot)
    if (!(input.isolate ?? settings.isolateByDefault)) {
      const projectId = project?.id ?? source.id
      return { workspaceId: projectId, isolated: false, destination: await destinationAt(location.repoRoot, false, project?.id ?? null) }
    }
    const thread = await requireThreads().provision(location.repoRoot, input.base, input.name)
    const workspace = await registry.create(thread.path, `${project?.title ?? basename(location.repoRoot)} · ${thread.name}`)
    emitActivity({ type: 'workspace.provisioned', summary: `New thread workspace ${thread.name}`, path: thread.path })
    const command = settings.setupCommand.trim()
    if (command !== '') void runSetupCommand(requireContext(), command, thread.path).catch(() => undefined)
    return { workspaceId: workspace.id, isolated: true, destination: await destinationAt(thread.path, true, project?.id ?? null) }
  },
  destination: async ({ input }) => {
    const registry = registryOf()
    const source = registry.get(WorkspaceId(input.workspaceId))
    const location =
      source === undefined
        ? undefined
        : await requireThreads()
            .locate(source.path)
            .catch(() => undefined)
    if (location === undefined) return noDestination(readSettings().isolateByDefault)
    return destinationAt(location.workspaceRoot, location.threadName !== undefined, (await registry.resolveByPath(location.repoRoot))?.id ?? null)
  },
  projects: async () => {
    const workspaces = [...registryOf().list()].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    const projects = []
    for (const workspace of workspaces) {
      const location = existsSync(workspace.path)
        ? await requireThreads()
            .locate(workspace.path)
            .catch(() => undefined)
        : undefined
      if (location?.threadName === undefined) projects.push({ workspaceId: workspace.id, title: workspace.title, path: workspace.path })
    }
    return { projects }
  },
  noFolder: async () => {
    const registry = registryOf()
    const directory = join(homedir(), '.dsh', 'no-folder')
    await mkdir(directory, { recursive: true })
    const existing = await registry.resolveByPath(directory)
    return { workspaceId: (existing ?? (await registry.create(directory, 'No folder'))).id }
  },
  repositories: async () => ({ repositories: [...(await listRepositories())] }),
  threadAt: async ({ input }) => {
    const location = await requireThreads()
      .locate(input.path)
      .catch(() => undefined)
    if (location?.threadName === undefined) return { thread: null }
    return { thread: (await findThread(location.workspaceRoot))?.thread ?? null }
  },
  land: ({ input }) => landThread({ path: input.path, sessionId: input.sessionId, fromAgent: false }),
  threadStatus: async ({ input, caller }) => {
    const found = await findThread((await requireThreads().locate(threadPath(input, caller))).workspaceRoot)
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
  const sweep = (): void => {
    void sweepFinishedThreads().catch(error => context.logger.warn('jj-integration: thread sweep failed: %o', error))
  }
  const firstSweep = setTimeout(sweep, 30_000)
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS)
  firstSweep.unref()
  timer.unref()
  return {
    async *[Symbol.asyncIterator]() {
      yield async () => {
        clearTimeout(firstSweep)
        clearInterval(timer)
        if (hostContext === context) {
          hostContext = undefined
          threads = undefined
        }
      }
    },
  }
}

export default defineHost({
  name: 'jj-integration',
  inject: ['subprocess'],
  settings: [ownedSettings],
  apis: [api],
  setup: setupHost,
})
