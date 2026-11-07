import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { Context, Effect, FileSystem, Layer, Option, Path } from 'effect'
import { loadProjectConfig } from '@dshfiles/workspace-folder-picker/project-config'
import type { DestinationView } from './api.js'
import { AgentOnly, NoPath, NotARepository, NotAThread, WorkspaceFilesFailed, WorkspaceNotFound } from './errors.js'
import { ActivityLog, WorkspaceRegistry } from './host-edges-promise.js'
import { IsolatedSessions } from './integration-requests.js'
import { JjSettings } from './jj-settings.js'
import { Landing, LandingMessages } from './landing.js'
import { NoFolderWorkspace } from './no-folder.js'
import { registeredProjects } from './registered-projects.js'
import { RepositoryViews } from './repository-views.js'
import { isolatesNewThreadsByDefault } from './settings.js'
import { workspaceHasOtherSession } from './thread-session-ownership.js'
import { ThreadWorkspaceModel } from './thread-workspace-model.js'
import { ThreadWorkspaces } from './thread-workspaces.js'
import { WorkspaceSync } from './workspace-sync.js'

const noDestination = (isolateByDefault: boolean): DestinationView => ({
  vcs: 'none',
  isolated: false,
  projectWorkspaceId: null,
  bookmark: null,
  bookmarks: [],
  isolateByDefault,
})

const DISCARD_ERROR_LENGTH = 400

/** Where threads run: provisioning, isolating and removing thread workspaces, and reading one thread's state. */
const make = Effect.gen(function* () {
  const threads = yield* ThreadWorkspaces
  const views = yield* RepositoryViews
  const registry = yield* WorkspaceRegistry
  const isolated = yield* IsolatedSessions
  const settings = yield* JjSettings
  const landing = yield* Landing
  const sync = yield* WorkspaceSync
  const log = yield* ActivityLog
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const exists = (target: string) => fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false))
  const isolateByDefault = Effect.map(settings.get, isolatesNewThreadsByDefault)
  /**
   * Where this repository starts new threads: `dsh.project.json` can declare it, and the profile setting decides when
   * it does not. Only `isolate: true` at a call site outranks both.
   */
  const isolationFor = (repoRoot: string) =>
    Effect.gen(function* () {
      const loaded = yield* loadProjectConfig(fileSystem, repoRoot)
      const declared = loaded.config?.defaultThreadWorkspace
      if (declared === undefined) return yield* isolateByDefault
      return declared === 'isolated'
    })
  const titleFor = (input: { readonly project: { readonly title: string } | undefined; readonly repoRoot: string; readonly name: string }) =>
    `${input.project?.title ?? path.basename(input.repoRoot)} · ${input.name}`

  const destinationAt = Effect.fnUntraced(function* (input: { readonly root: string; readonly isolated: boolean; readonly projectWorkspaceId: string | null }) {
    const [bookmarks, vcs] = yield* Effect.all([threads.bookmarks(input.root), threads.vcsAt(input.root)], { concurrency: 'unbounded' })
    return {
      vcs,
      isolated: input.isolated,
      projectWorkspaceId: input.projectWorkspaceId,
      bookmark: bookmarks.current,
      bookmarks: [...bookmarks.names],
      isolateByDefault: yield* isolateByDefault,
    } satisfies DestinationView
  })

  const provision = Effect.fn('thread lifecycle provision')(function* (input: {
    readonly workspaceId: string
    readonly isolate?: boolean | undefined
    readonly base?: string | undefined
    readonly name?: string | undefined
  }) {
    const source = yield* registry.get(input.workspaceId)
    if (source === undefined) return yield* new WorkspaceNotFound({ detail: `Unknown workspace ${input.workspaceId}.` })
    const location = yield* views.location(source.path)
    if (Option.isNone(location)) return { workspaceId: source.id, isolated: false, destination: noDestination(yield* isolateByDefault) }
    const repoRoot = location.value.repoRoot
    const project = yield* registry.resolveByPath(repoRoot)
    if (!(input.isolate ?? (yield* isolationFor(repoRoot))))
      return {
        workspaceId: project?.id ?? source.id,
        isolated: false,
        destination: yield* destinationAt({ root: repoRoot, isolated: false, projectWorkspaceId: project?.id ?? null }),
      }
    const thread = yield* threads.provision(repoRoot, input.base, input.name)
    const workspace = yield* registry.create({ path: thread.path, title: titleFor({ project, repoRoot, name: thread.name }) })
    yield* log.emit({ type: 'workspace.provisioned', summary: `New thread workspace ${thread.name}`, path: thread.path })
    yield* views.invalidate
    return {
      workspaceId: workspace.id,
      isolated: true,
      destination: yield* destinationAt({ root: thread.path, isolated: true, projectWorkspaceId: project?.id ?? null }),
    }
  })

  const isolate = Effect.fn('thread lifecycle isolate')(function* (caller: ApiCaller) {
    if (caller.kind !== 'agent') return yield* new AgentOnly({})
    const sessionId = caller.sessionId
    const cwd = caller.cwd
    if (sessionId === undefined || cwd === undefined) return yield* new NoPath({ detail: 'This agent Session has no working directory to isolate.' })
    const existing = yield* isolated.get(sessionId)
    if (existing !== undefined) return { ...existing, created: false }
    const location = yield* threads
      .locate(cwd)
      .pipe(
        Effect.catchTag('NotARepository', () =>
          Effect.fail(new NotARepository({ detail: 'Workspace isolation requires a Session inside a local jj or git repository.' })),
        ),
      )
    if (location.threadName !== undefined) {
      yield* isolated.set({ sessionId, name: location.threadName, path: location.workspaceRoot })
      return { name: location.threadName, path: location.workspaceRoot, created: false }
    }
    const thread = yield* threads.provision(location.repoRoot)
    const project = yield* registry.resolveByPath(location.repoRoot)
    if ((yield* registry.resolveByPath(thread.path)) === undefined)
      yield* registry.create({ path: thread.path, title: titleFor({ project, repoRoot: location.repoRoot, name: thread.name }) })
    yield* isolated.set({ sessionId, name: thread.name, path: thread.path })
    yield* log.emit({ type: 'workspace.provisioned', summary: `New thread workspace ${thread.name}`, path: thread.path })
    yield* views.invalidate
    return { ...thread, created: true }
  })

  const destination = Effect.fn('thread lifecycle destination')(function* (input: { readonly workspaceId: string; readonly sessionId?: string | undefined }) {
    const source = yield* registry.get(input.workspaceId)
    if (source === undefined) return yield* new WorkspaceNotFound({ detail: 'The workspace destination is unknown. Refresh and retry.' })
    const ownedByAnotherSession =
      input.sessionId === undefined ? undefined : workspaceHasOtherSession({ sessionId: input.sessionId, workspaceSessionIds: source.sessionIds })
    const withOwnership = (view: DestinationView): DestinationView => (ownedByAnotherSession === undefined ? view : { ...view, ownedByAnotherSession })
    const location = yield* views.location(source.path)
    if (Option.isNone(location)) return withOwnership(noDestination(yield* isolateByDefault))
    const [project, located] = yield* Effect.all(
      [
        registry.resolveByPath(location.value.repoRoot),
        destinationAt({ root: location.value.workspaceRoot, isolated: location.value.threadName !== undefined, projectWorkspaceId: null }),
      ],
      { concurrency: 'unbounded' },
    )
    // A new thread that will isolate on its first send finds its workspace already checked out.
    if (location.value.threadName === undefined && located.isolateByDefault) yield* threads.prewarm(location.value.repoRoot)
    return withOwnership({ ...located, projectWorkspaceId: project?.id ?? null })
  })

  const ownWorkspaceFor = Effect.fn('thread lifecycle own workspace')(function* (input: { readonly workspaceId: string }) {
    const unchanged = { workspaceId: input.workspaceId, branched: false }
    const source = yield* registry.get(input.workspaceId)
    if (source === undefined || source.sessionIds.length === 0) return unchanged
    const location = yield* views.bestEffortLocation(source.path)
    if (Option.isNone(location) || location.value.threadName === undefined) return unchanged
    const thread = yield* threads.provision(location.value.repoRoot, yield* threads.branchPoint(location.value.workspaceRoot))
    const project = yield* registry.resolveByPath(location.value.repoRoot)
    const workspace = yield* registry.create({ path: thread.path, title: titleFor({ project, repoRoot: location.value.repoRoot, name: thread.name }) })
    yield* log.emit({
      type: 'workspace.provisioned',
      summary: `New thread workspace ${thread.name} branched from ${location.value.threadName}`,
      path: thread.path,
    })
    yield* views.invalidate
    return { workspaceId: workspace.id, branched: true }
  })

  const classifyWorkspaces = Effect.fn('thread lifecycle classify')(function* (input: { readonly workspaceIds: readonly string[] }) {
    const classified = yield* Effect.forEach(
      [...new Set(input.workspaceIds)],
      workspaceId =>
        Effect.gen(function* () {
          const workspace = yield* registry.get(workspaceId)
          if (workspace === undefined || !(yield* exists(workspace.path))) return false
          const location = yield* threads.locate(workspace.path).pipe(Effect.option)
          return Option.isSome(location) && ThreadWorkspaceModel.isSecondaryWorkspace(location.value)
        }).pipe(Effect.map(secondary => (secondary ? [workspaceId] : []))),
      { concurrency: 8 },
    )
    return { jjWorkspaceIds: classified.flat() }
  })

  const projects = Effect.gen(function* () {
    const workspaces = [...(yield* registry.list)].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    const registered = yield* registeredProjects({
      workspaces: workspaces.map(workspace => ({ workspaceId: workspace.id, title: workspace.title, path: workspace.path })),
      classify: folder =>
        Effect.gen(function* () {
          if (!(yield* exists(folder))) return 'missing' as const
          const location = yield* views.bestEffortLocation(folder)
          return Option.isSome(location) && ThreadWorkspaceModel.isSecondaryWorkspace(location.value) ? ('workspace' as const) : ('project' as const)
        }),
    })
    return { projects: [...registered.projects], workspaces: [...registered.workspaces] }
  }).pipe(Effect.withSpan('thread lifecycle projects'))

  /** One fresh scratch folder name: the date, then six random hex digits, like a dated scratch directory. */
  const scratchFolderName = (): string => {
    const today = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
    return `${date}-${randomUUID().replaceAll('-', '').slice(0, 6)}`
  }

  const noFolder = Effect.gen(function* () {
    const root = path.join(homedir(), NoFolderWorkspace.pathMarker)
    const create = (directory: string) =>
      fileSystem
        .makeDirectory(directory, { recursive: true })
        .pipe(Effect.mapError(cause => new WorkspaceFilesFailed({ detail: `Could not create ${directory}.`, cause })))
    yield* create(root)
    // One folder per scratch thread, so turning one into a project groups only that thread. A scratch folder no Session
    // was accounted to is reused instead of growing the list on every New thread click.
    const workspaces = yield* registry.list
    const present = yield* Effect.forEach(workspaces, workspace => exists(workspace.path).pipe(Effect.map(present => ({ path: workspace.path, present }))), {
      concurrency: 'unbounded',
    })
    let directory = NoFolderWorkspace.reusablePath({
      root,
      workspaces,
      presentPaths: new Set(present.filter(entry => entry.present).map(entry => entry.path)),
    })
    if (directory === undefined) {
      directory = path.join(root, scratchFolderName())
      yield* create(directory)
    }
    const existing = yield* registry.resolveByPath(directory)
    return { workspaceId: (existing ?? (yield* registry.create({ path: directory, title: NoFolderWorkspace.workspaceTitle }))).id }
  }).pipe(Effect.withSpan('thread lifecycle no folder'))

  const threadAt = Effect.fn('thread lifecycle thread at')(function* (input: { readonly path: string; readonly sessionId?: string | undefined }) {
    const location = yield* threads.locate(input.path).pipe(Effect.option)
    if (Option.isNone(location)) return { thread: null }
    const found = yield* views.findThread({ location: location.value, includeActivity: false, viewerSessionId: input.sessionId })
    return { thread: found?.thread ?? null }
  })

  const reviewHistory = Effect.fn('thread lifecycle review history')(function* (input: { readonly path: string }) {
    if (!path.isAbsolute(input.path)) return yield* new NotAThread({ detail: 'The removed thread workspace path must be absolute.' })
    const workspacePath = path.resolve(input.path)
    const threadDirectory = path.dirname(workspacePath)
    const workspaces = yield* registry.list
    const directories = yield* Effect.forEach(workspaces, workspace => threads.threadsDirectory(workspace.path))
    const project = workspaces.find((_, index) => path.resolve(directories[index] ?? '') === threadDirectory)
    if (project === undefined) return yield* new NotAThread({ detail: 'The owning project for this removed thread workspace is not registered.' })
    const history = yield* threads.reviewHistory({ repoRoot: project.path, name: path.basename(workspacePath) })
    return {
      repoRoot: history.repoRoot,
      name: history.name,
      integrations: history.integrations.map(record => ({
        at: record.at,
        ...(record.tipChangeId !== undefined && { tipChangeId: record.tipChangeId }),
        ...(record.baseChangeId !== undefined && { baseChangeId: record.baseChangeId }),
        ...(record.sessionId !== undefined && { sessionId: record.sessionId }),
      })),
    }
  })

  const threadPath = Effect.fnUntraced(function* (input: { readonly path?: string | undefined }, caller: ApiCaller) {
    const isolatedPath = caller.kind === 'agent' && caller.sessionId !== undefined ? (yield* isolated.get(caller.sessionId))?.path : undefined
    const target = input.path ?? isolatedPath ?? (caller.kind === 'agent' ? caller.cwd : undefined)
    if (target === undefined) return yield* new NoPath({ detail: 'Pass the thread workspace path; this caller has no working directory.' })
    return target
  })

  const threadStatus = Effect.fn('thread lifecycle thread status')(function* (input: { readonly path?: string | undefined }, caller: ApiCaller) {
    const location = yield* threads.locate(yield* threadPath(input, caller))
    const found = yield* views.findThread({
      location,
      caller: caller.kind === 'agent' ? { fromAgent: true, sessionId: caller.sessionId } : { fromAgent: false, sessionId: undefined },
    })
    return { bookmark: (yield* settings.get).bookmark, thread: found?.thread ?? null }
  })

  const landThread = Effect.fn('thread lifecycle land thread')(function* (
    input: { readonly path?: string | undefined; readonly bookmark?: string | undefined },
    caller: ApiCaller,
  ) {
    const location = yield* threads.locate(yield* threadPath(input, caller))
    if (location.threadName === undefined) return { summary: 'This Session does not run in a thread workspace; nothing to rebase.', result: null }
    const result = yield* landing.land({
      path: location.workspaceRoot,
      sessionId: caller.kind === 'agent' ? caller.sessionId : undefined,
      fromAgent: caller.kind === 'agent',
      bookmark: input.bookmark,
    })
    return { summary: LandingMessages.forResult(result) ?? JSON.stringify(result), result }
  })

  const discard = Effect.fn('thread lifecycle discard')(function* (input: { readonly path: string; readonly force: boolean }) {
    const location = yield* threads.locate(input.path).pipe(Effect.option)
    const found = Option.isNone(location) ? undefined : yield* views.findThread({ location: location.value })
    if (found === undefined) return yield* new NotAThread({ detail: `${input.path} is not a thread workspace.` })
    const outcome = yield* threads.discard({ repoRoot: found.repoRoot, name: found.thread.name, force: input.force })
    if (outcome.status === 'discarded') {
      if (found.thread.workspaceId !== null) yield* registry.remove(found.thread.workspaceId)
      yield* isolated.forget(found.thread.path)
      const correlationId = randomUUID()
      yield* log.emit({ type: 'workspace.discarded', summary: `Removed thread workspace ${found.thread.name}`, path: input.path, correlationId })
      yield* sync.enqueue({ repoRoot: found.repoRoot, bookmark: (yield* settings.get).bookmark, correlationId })
      yield* views.invalidate
    }
    return { status: outcome.status, revisions: outcome.status === 'has-work' ? [...outcome.revisions] : [] }
  })

  const discardMany = Effect.fn('thread lifecycle discard many')(function* (input: { readonly paths: readonly string[]; readonly force: boolean }) {
    const results = yield* Effect.forEach(input.paths, target =>
      discard({ path: target, force: input.force }).pipe(
        Effect.map(result => ({ path: target, ...result, error: null })),
        Effect.catch(error => Effect.succeed({ path: target, status: 'error' as const, revisions: [], error: error.message.slice(0, DISCARD_ERROR_LENGTH) })),
      ),
    )
    return { results }
  })

  /** A deleted thread folder must not fail the next turn of a Session pinned to it: check the workspace out again first. */
  const restoreMissing = Effect.fn('thread lifecycle restore missing')(function* (input: { readonly path: string; readonly sessionId: string }) {
    if ((yield* exists(path.join(input.path, '.jj'))) || (yield* exists(path.join(input.path, '.git')))) return
    for (const workspace of yield* registry.list) {
      if (!(yield* exists(workspace.path)) || (yield* threads.threadsDirectory(workspace.path)) !== path.dirname(input.path)) continue
      const location = yield* views.bestEffortLocation(workspace.path)
      if (Option.isNone(location) || location.value.repoRoot !== location.value.workspaceRoot) continue
      yield* threads.restore(location.value.repoRoot, input.path)
      if ((yield* registry.resolveByPath(input.path)) === undefined) {
        const project = yield* registry.resolveByPath(location.value.repoRoot)
        yield* registry.create({ path: input.path, title: titleFor({ project, repoRoot: location.value.repoRoot, name: path.basename(input.path) }) })
      }
      yield* views.forgetLocation(input.path)
      yield* views.invalidate
      yield* log.emit({
        type: 'workspace.restored',
        summary: `Restored deleted thread workspace ${path.basename(input.path)}`,
        path: input.path,
        sessionId: input.sessionId,
      })
      return
    }
  })

  return {
    provision,
    isolate,
    destination,
    ownWorkspaceFor,
    classifyWorkspaces,
    projects,
    noFolder,
    threadAt,
    reviewHistory,
    threadStatus,
    landThread,
    discard,
    discardMany,
    restoreMissing,
  }
})

export class ThreadLifecycle extends Context.Service<ThreadLifecycle, Effect.Success<typeof make>>()('@dshfiles/jj-integration/ThreadLifecycle') {
  static readonly layer = Layer.effect(ThreadLifecycle, make)
}
