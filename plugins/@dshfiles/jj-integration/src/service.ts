import { mkdir, open, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  integrationLockSchema,
  jjIntegrationStateSchema,
  noneValidation,
  stagingJournalSchema,
  type ConflictRecord,
  type IntegrationAttempt,
  type IntegrationCandidate,
  type IntegrationEvent,
  type IntegrationEventType,
  type IntegrationLock,
  type JjIntegrationState,
  type JjRevision,
  type RepositoryRecord,
  type StagingJournalEntry,
  type ValidationRecord,
  type WorkspaceLifecycle,
  type WorkspaceRecord,
} from './types.js'
import {
  JjCommandError,
  abandonRevision,
  addWorkspace,
  changedFiles,
  conflictFiles,
  duplicateOnto,
  forgetWorkspace,
  isAncestor,
  isRevisionEmpty,
  resolveRevision,
  revisionExists,
  runValidationCommand,
  setBookmark,
  workspaceRoot,
  type CommandExecutor,
  type JjExecutor,
  type ObservedRevision,
} from './jj.js'

const MAX_EVENTS = 2000
const MAX_CANDIDATES = 512
const LOCK_TTL_MS = 10 * 60 * 1000
const LOCK_GRACE_MS = 5_000
const LOCK_FILE_NAME = '.dshfiles-jj-integration.lock'
const STAGING_JOURNAL_FILE_NAME = '.dshfiles-jj-integration.staging.json'
const STAGING_PREFIX = 'jjint-validate-'

export class IntegrationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'IntegrationError'
  }
}

export interface JjIntegrationServiceOptions {
  readonly statePath?: string
  readonly now?: () => number
  readonly spineBookmark?: string
  readonly validationCommand?: string
  readonly allowAnyAgentIntegration?: boolean
  readonly coordinatorSessions?: readonly string[]
  readonly onEvent?: (event: IntegrationEvent) => void
}

export interface IntegrationRunResult {
  readonly outcome: IntegrationAttempt['outcome']
  readonly candidate: IntegrationCandidate
  readonly detail: string
}

const initialState = (): JjIntegrationState => ({ schemaVersion: 1, repositories: [], workspaces: [], candidates: [], events: [] })

const defaultStatePath = (): string => {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'runtime', 'dshfiles', 'jj-integration', 'state.json')
}

const jjStorePath = async (root: string): Promise<string> => {
  const markerPath = join(root, '.jj', 'repo')
  const markerStats = await stat(markerPath).catch(() => undefined)
  if (markerStats === undefined) throw new IntegrationError('not-a-jj-repository', `${root} is not a Jujutsu workspace.`)
  if (markerStats.isDirectory()) return realpath(markerPath)
  const marker = (await readFile(markerPath, 'utf8')).trim()
  if (marker.length === 0) throw new IntegrationError('not-a-jj-repository', `The Jujutsu store marker in ${root} is empty.`)
  const candidates = isAbsolute(marker) ? [marker] : [resolve(dirname(markerPath), marker), resolve(root, marker)]
  for (const candidate of candidates) {
    const store = await realpath(candidate).catch(() => undefined)
    if (store !== undefined) return store
  }
  throw new IntegrationError('not-a-jj-repository', `The Jujutsu store for ${root} could not be resolved.`)
}

export const repositoryStatePaths = async (root: string): Promise<{ readonly lockPath: string; readonly stagingJournalPath: string }> => {
  const store = await jjStorePath(root)
  return {
    lockPath: join(store, LOCK_FILE_NAME),
    stagingJournalPath: join(store, STAGING_JOURNAL_FILE_NAME),
  }
}

const pathExists = async (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

const toRevision = (observed: ObservedRevision): JjRevision => ({
  changeId: observed.changeId,
  commitId: observed.commitId,
  description: observed.description,
})

const cleanRevision = (revision: JjRevision | null | undefined): JjRevision | null =>
  revision === null || revision === undefined
    ? null
    : { changeId: revision.changeId, commitId: revision.commitId, description: revision.description }
const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 500)

export class JjIntegrationService {
  readonly #statePath: string
  readonly #now: () => number
  readonly #spineBookmark: string
  readonly #validationCommand: string | undefined
  readonly #allowAnyAgentIntegration: boolean
  readonly #coordinatorSessions: ReadonlySet<string>
  readonly #onEvent: ((event: IntegrationEvent) => void) | undefined
  readonly #executor: JjExecutor
  readonly #executeCommand: CommandExecutor | undefined
  #writes: Promise<void> = Promise.resolve()
  #mutations: Promise<void> = Promise.resolve()

  constructor(input: {
    readonly executor: JjExecutor
    readonly executeCommand?: CommandExecutor
    readonly options?: JjIntegrationServiceOptions
  }) {
    const options = input.options ?? {}
    this.#executor = input.executor
    this.#executeCommand = input.executeCommand
    this.#statePath = options.statePath ?? defaultStatePath()
    this.#now = options.now ?? Date.now
    this.#spineBookmark = options.spineBookmark ?? 'integration-spine'
    this.#validationCommand = options.validationCommand
    this.#allowAnyAgentIntegration = options.allowAnyAgentIntegration ?? false
    this.#coordinatorSessions = new Set(options.coordinatorSessions ?? [])
    this.#onEvent = options.onEvent
  }

  async overview(): Promise<{ readonly state: JjIntegrationState; readonly spineBookmark: string }> {
    return { state: await this.#readState(), spineBookmark: this.#spineBookmark }
  }

  async listWorkspaces(): Promise<readonly WorkspaceRecord[]> {
    return (await this.#readState()).workspaces
  }

  async listCandidates(): Promise<readonly IntegrationCandidate[]> {
    return [...(await this.#readState()).candidates].sort(compareCandidates)
  }

  async listEvents(limit = 100): Promise<readonly IntegrationEvent[]> {
    const bounded = Math.max(1, Math.min(500, Math.trunc(limit)))
    const state = await this.#readState()
    return state.events.slice(-bounded).reverse()
  }

  async registerWorkspace(input: {
    readonly path: string
    readonly sessionId: string | null
    readonly source: 'session-cwd' | 'agent-tool' | 'human'
    readonly signal?: AbortSignal
  }): Promise<WorkspaceRecord> {
    return this.#serialize(async () => {
      const root = await workspaceRoot(this.#executor, input.path, input.signal)
      const revision = await resolveRevision(this.#executor, input.path, '@', input.signal)
      const now = this.#now()
      return this.#updateState(state => {
        const repository = state.repositories.find(item => item.root === root) ?? this.#newRepository(root, now)
        const existing = state.workspaces.find(item => item.repositoryId === repository.id && item.path === input.path)
        const workspace = existing ?? this.#newWorkspace({ repositoryId: repository.id, path: input.path, now })
        const owners = input.sessionId === null ? workspace.owners : attachOwner(workspace.owners, input.sessionId, input.source, now)
        const record: WorkspaceRecord = {
          ...workspace,
          currentRevision: toRevision(revision),
          owners,
          lifecycle: workspace.lifecycle === 'created' ? 'active' : workspace.lifecycle,
          updatedAt: now,
          lastObservedAt: now,
          missing: false,
        }
        const workspaces = existing === undefined
          ? [...state.workspaces, record]
          : state.workspaces.map(item => (item.id === record.id ? record : item))
        const repositories = state.repositories.some(item => item.id === repository.id)
          ? state.repositories
          : [...state.repositories, repository]
        return {
          state: { ...state, repositories, workspaces },
          value: record,
          events: [
            this.#event(existing === undefined ? 'workspace.created' : 'workspace.attached', {
              repositoryId: repository.id,
              workspaceId: record.id,
              sessionId: input.sessionId,
              revisions: { source: record.currentRevision },
              detail: input.path,
            }),
          ],
        }
      })
    })
  }

  async refreshWorkspace(id: string, signal?: AbortSignal): Promise<WorkspaceRecord> {
    return this.#serialize(async () => {
      const state = await this.#readState()
      const workspace = state.workspaces.find(item => item.id === id)
      if (workspace === undefined) throw new IntegrationError('workspace-not-found', 'Workspace is not registered.')
      const now = this.#now()
      try {
        const root = await workspaceRoot(this.#executor, workspace.path, signal)
        const revision = await resolveRevision(this.#executor, workspace.path, '@', signal)
        const changed = workspace.currentRevision?.commitId !== revision.commitId
        return this.#updateState(current => {
          const owners = current.workspaces.find(item => item.id === id)?.owners ?? workspace.owners
          const lifecycle: WorkspaceLifecycle =
            workspace.lifecycle === 'created' || (workspace.lifecycle === 'idle' && owners.some(owner => owner.detachedAt === null))
              ? 'active'
              : workspace.lifecycle
          const record: WorkspaceRecord = {
            ...workspace,
            lifecycle,
            currentRevision: toRevision(revision),
            updatedAt: now,
            lastObservedAt: now,
            missing: false,
          }
          return {
            state: { ...current, workspaces: current.workspaces.map(item => (item.id === id ? record : item)) },
            value: record,
            events: changed
              ? [this.#event('workspace.refreshed', { repositoryId: record.repositoryId, workspaceId: id, revisions: { source: record.currentRevision }, detail: root })]
              : [],
          }
        })
      } catch (error) {
        const record: WorkspaceRecord = { ...workspace, missing: true, updatedAt: now }
        return this.#updateState(current => ({
          state: { ...current, workspaces: current.workspaces.map(item => (item.id === id ? record : item)) },
          value: record,
          events: [this.#event('workspace.missing', { repositoryId: workspace.repositoryId, workspaceId: id, detail: describeError(error) })],
        }))
      }
    })
  }

  async inspectWorkspace(id: string, signal?: AbortSignal): Promise<{
    readonly workspace: WorkspaceRecord
    readonly repository: RepositoryRecord
    readonly spine: JjRevision | null
    readonly source: JjRevision | null
    readonly sourceInSpine: boolean
    readonly spineInSource: boolean
  }> {
    const state = await this.#readState()
    const workspace = state.workspaces.find(item => item.id === id)
    if (workspace === undefined) throw new IntegrationError('workspace-not-found', 'Workspace is not registered.')
    const repository = state.repositories.find(item => item.id === workspace.repositoryId)
    if (repository === undefined) throw new IntegrationError('repository-not-found', 'Repository is not registered.')
    const spine = await this.#resolveOptional(repository.root, repository.spineBookmark, signal)
    const source = workspace.missing ? undefined : await this.#resolveOptional(workspace.path, '@', signal)
    return {
      workspace,
      repository,
      spine: spine === undefined ? null : toRevision(spine),
      source: source === undefined ? null : toRevision(source),
      sourceInSpine: spine !== undefined && source !== undefined && (await isAncestor(this.#executor, repository.root, source.commitId, spine.commitId, signal)),
      spineInSource: spine !== undefined && source !== undefined && (await isAncestor(this.#executor, repository.root, spine.commitId, source.commitId, signal)),
    }
  }

  async attachSession(id: string, sessionId: string, source: 'session-cwd' | 'agent-tool' | 'human'): Promise<WorkspaceRecord> {    return this.#serialize(() =>
      this.#updateState(state => {
        const workspace = state.workspaces.find(item => item.id === id)
        if (workspace === undefined) throw new IntegrationError('workspace-not-found', 'Workspace is not registered.')
        const now = this.#now()
        const record: WorkspaceRecord = { ...workspace, owners: attachOwner(workspace.owners, sessionId, source, now), updatedAt: now }
        return {
          state: { ...state, workspaces: state.workspaces.map(item => (item.id === id ? record : item)) },
          value: record,
          events: [this.#event('workspace.attached', { repositoryId: record.repositoryId, workspaceId: id, sessionId })],
        }
      }),
    )
  }

  async detachSession(id: string, sessionId: string): Promise<WorkspaceRecord> {
    return this.#serialize(() =>
      this.#updateState(state => {
        const workspace = state.workspaces.find(item => item.id === id)
        if (workspace === undefined) throw new IntegrationError('workspace-not-found', 'Workspace is not registered.')
        const now = this.#now()
        const owners = workspace.owners.map(owner =>
          owner.sessionId === sessionId && owner.detachedAt === null ? { ...owner, detachedAt: now } : owner,
        )
        const stillActive = owners.some(owner => owner.detachedAt === null)
        const record: WorkspaceRecord = {
          ...workspace,
          owners,
          lifecycle: workspace.lifecycle === 'active' && !stillActive ? 'idle' : workspace.lifecycle,
          updatedAt: now,
        }
        return {
          state: { ...state, workspaces: state.workspaces.map(item => (item.id === id ? record : item)) },
          value: record,
          events: [this.#event('workspace.detached', { repositoryId: record.repositoryId, workspaceId: id, sessionId })],
        }
      }),
    )
  }

  async markReady(id: string, sessionId: string | null): Promise<WorkspaceRecord> {
    return this.#serialize(() =>
      this.#updateState(state => {
        const workspace = state.workspaces.find(item => item.id === id)
        if (workspace === undefined) throw new IntegrationError('workspace-not-found', 'Workspace is not registered.')
        const now = this.#now()
        const record: WorkspaceRecord = { ...workspace, lifecycle: 'ready', updatedAt: now }
        return {
          state: { ...state, workspaces: state.workspaces.map(item => (item.id === id ? record : item)) },
          value: record,
          events: [this.#event('workspace.ready', { repositoryId: record.repositoryId, workspaceId: id, sessionId })],
        }
      }),
    )
  }

  async submitCandidate(input: {
    readonly workspaceId: string
    readonly sessionId: string | null
    readonly revision?: string
    readonly dependsOn?: readonly string[]
    readonly correlationId?: string
    readonly signal?: AbortSignal
  }): Promise<IntegrationCandidate> {
    return this.#serialize(async () => {
      const state = await this.#readState()
      const workspace = state.workspaces.find(item => item.id === input.workspaceId)
      if (workspace === undefined) throw new IntegrationError('workspace-not-found', 'Workspace is not registered.')
      const repository = state.repositories.find(item => item.id === workspace.repositoryId)
      if (repository === undefined) throw new IntegrationError('repository-not-found', 'Repository is not registered.')
      const source = input.revision === undefined
        ? await resolveRevision(this.#executor, workspace.path, '@', input.signal)
        : await resolveRevision(this.#executor, workspace.path, input.revision, input.signal)
      const spine = await resolveRevision(this.#executor, repository.root, repository.spineBookmark, input.signal)
      if (await isRevisionEmpty(this.#executor, workspace.path, source.changeId, input.signal)) {
        throw new IntegrationError('empty-revision', 'The selected source revision contains no changes to integrate.')
      }
      const dependsOn = [...new Set(input.dependsOn ?? [])]
      const candidateId = randomUUID()
      for (const dependencyId of dependsOn) {
        if (dependencyId === candidateId) throw new IntegrationError('invalid-dependency', 'A candidate cannot depend on itself.')
        if (!state.candidates.some(candidate => candidate.id === dependencyId)) {
          throw new IntegrationError('dependency-not-found', `Dependency ${dependencyId} is not a known candidate.`)
        }
      }
      assertNoDependencyCycle(state.candidates, candidateId, dependsOn)
      const existing = state.candidates.find(
        candidate =>
          candidate.repositoryId === repository.id &&
          candidate.sourceRevision.commitId === source.commitId &&
          candidate.state !== 'cancelled',
      )
      if (existing !== undefined) return existing
      const now = this.#now()
      const candidate: IntegrationCandidate = {
        id: candidateId,
        repositoryId: repository.id,
        workspaceId: workspace.id,
        sourceSessionId: input.sessionId,
        sourceRevision: toRevision(source),
        spineAtSubmit: toRevision(spine),
        dependsOn,
        state: 'queued',
        correlationId: input.correlationId ?? null,
        createdAt: now,
        updatedAt: now,
        attempts: [],
        resultRevision: null,
        conflict: null,
        validation: noneValidation(),
        error: null,
        queuePosition: state.candidates.reduce((max, item) => Math.max(max, item.queuePosition), 0) + 1,
      }
      return this.#updateState(current => ({
        state: {
          ...current,
          candidates: [...current.candidates, candidate].slice(-MAX_CANDIDATES),
          workspaces: current.workspaces.map(item =>
            item.id === workspace.id && (item.lifecycle === 'created' || item.lifecycle === 'active' || item.lifecycle === 'idle')
              ? { ...item, lifecycle: 'ready' as const, updatedAt: now }
              : item,
          ),
        },
        value: candidate,
        events: [
          this.#event('integration.queued', {
            repositoryId: repository.id,
            workspaceId: workspace.id,
            sessionId: input.sessionId,
            candidateId: candidate.id,
            correlationId: candidate.correlationId,
            revisions: { source: candidate.sourceRevision, spineBefore: candidate.spineAtSubmit },
            detail: candidate.sourceRevision.description,
          }),
        ],
      }))
    })
  }

  async inspectCandidate(id: string, signal?: AbortSignal): Promise<{
    readonly candidate: IntegrationCandidate
    readonly alreadyIntegrated: boolean
    readonly sourceStale: boolean
    readonly sourceMissing: boolean
    readonly changedFiles: readonly string[]
    readonly spineChangedFiles: readonly string[]
    readonly overlappingFiles: readonly string[]
    readonly dependencies: readonly { readonly id: string; readonly state: string }[]
  }> {
    const state = await this.#readState()
    const candidate = state.candidates.find(item => item.id === id)
    if (candidate === undefined) throw new IntegrationError('candidate-not-found', 'Integration candidate is not registered.')
    const repository = state.repositories.find(item => item.id === candidate.repositoryId)
    if (repository === undefined) throw new IntegrationError('repository-not-found', 'Repository is not registered.')
    const workspace = state.workspaces.find(item => item.id === candidate.workspaceId)
    const spine = await this.#resolveOptional(repository.root, repository.spineBookmark, signal)
    const alreadyIntegrated =
      candidate.state === 'integrated' ||
      candidate.state === 'already-integrated' ||
      (spine !== undefined && (await isAncestor(this.#executor, repository.root, candidate.sourceRevision.commitId, spine.commitId, signal))) ||
      state.candidates.some(
        other =>
          other.id !== candidate.id &&
          other.state === 'integrated' &&
          other.sourceRevision.commitId === candidate.sourceRevision.commitId,
      )
    const sourceMissing = workspace === undefined || workspace.missing
    const sourceStale =
      !sourceMissing &&
      (workspace.currentRevision === null ||
        workspace.currentRevision.commitId !== candidate.sourceRevision.commitId ||
        !(await revisionExists(this.#executor, workspace.path, candidate.sourceRevision.changeId, signal)))
    const sourceChanged =
      spine === undefined
        ? []
        : await changedFiles(this.#executor, repository.root, spine.commitId, candidate.sourceRevision.commitId, signal).catch(() => [])
    const spineChanged =
      candidate.spineAtSubmit === null || spine === undefined
        ? []
        : await changedFiles(this.#executor, repository.root, candidate.spineAtSubmit.commitId, spine.commitId, signal).catch(() => [])
    const spineChangedSet = new Set(spineChanged)
    return {
      candidate,
      alreadyIntegrated,
      sourceStale,
      sourceMissing,
      changedFiles: sourceChanged,
      spineChangedFiles: spineChanged,
      overlappingFiles: sourceChanged.filter(file => spineChangedSet.has(file)),
      dependencies: candidate.dependsOn.map(dependencyId => ({
        id: dependencyId,
        state: state.candidates.find(item => item.id === dependencyId)?.state ?? 'unknown',
      })),
    }
  }

  async runCandidate(input: {
    readonly candidateId: string
    readonly sessionId: string | null
    readonly signal?: AbortSignal
  }): Promise<IntegrationRunResult> {
    return this.#serialize(async () => {
      const discovery = await this.#readState()
      const discovered = discovery.candidates.find(item => item.id === input.candidateId)
      if (discovered === undefined) throw new IntegrationError('candidate-not-found', 'Integration candidate is not registered.')
      const discoveredRepository = discovery.repositories.find(item => item.id === discovered.repositoryId)
      if (discoveredRepository === undefined) throw new IntegrationError('repository-not-found', 'Repository is not registered.')
      // A registered workspace can be removed between runs, leaving no .jj marker to key the store lock on.
      const paths = await repositoryStatePaths(discoveredRepository.root).catch(() => undefined)
      if (paths === undefined) {
        this.#assertMayRun(discovered, input.sessionId)
        if (discovered.state === 'integrated' || discovered.state === 'already-integrated') {
          return { outcome: 'already-integrated', candidate: discovered, detail: 'Candidate was already integrated.' }
        }
        if (discovered.state === 'running') {
          throw new IntegrationError('candidate-running', 'Candidate is already running; wait for that integration to finish or fail before retrying.')
        }
        return this.#failCandidate(discovered, 'failed', 'Source workspace is missing or unavailable.')
      }
      return this.#withLock(paths.lockPath, async () => {
        const state = await this.#readState()
        const candidate = state.candidates.find(item => item.id === input.candidateId)
        if (candidate === undefined) throw new IntegrationError('candidate-not-found', 'Integration candidate is not registered.')
        this.#assertMayRun(candidate, input.sessionId)
        if (candidate.state === 'integrated' || candidate.state === 'already-integrated') {
          return { outcome: 'already-integrated', candidate, detail: 'Candidate was already integrated.' }
        }
        if (candidate.state === 'running') {
          throw new IntegrationError('candidate-running', 'Candidate is already running; wait for that integration to finish or fail before retrying.')
        }
        const repository = state.repositories.find(item => item.id === candidate.repositoryId)
        if (repository === undefined) throw new IntegrationError('repository-not-found', 'Repository is not registered.')
        await this.#reapStaging(repository, input.signal)
        const workspace = state.workspaces.find(item => item.id === candidate.workspaceId)
        if (workspace === undefined || workspace.missing) {
          return this.#failCandidate(candidate, 'failed', 'Source workspace is missing or unavailable.')
        }
        const dependencies = candidate.dependsOn.map(dependencyId => state.candidates.find(item => item.id === dependencyId))
        const unmet = dependencies.filter(item => item === undefined || (item.state !== 'integrated' && item.state !== 'already-integrated'))
        if (unmet.length > 0) {
          return this.#failCandidate(candidate, 'blocked', `Waiting for ${String(unmet.length)} dependency candidate(s).`)
        }
        const spine = await this.#resolveOptional(repository.root, repository.spineBookmark, input.signal)
        if (spine === undefined) return this.#failCandidate(candidate, 'failed', `Canonical bookmark ${repository.spineBookmark} does not exist.`)
        const currentSource = await this.#resolveOptional(workspace.path, '@', input.signal)
        if (currentSource === undefined) return this.#failCandidate(candidate, 'failed', 'Source workspace revision could not be resolved.')
        if (currentSource.commitId !== candidate.sourceRevision.commitId) {
          return this.#failCandidate(candidate, 'stale', 'Source revision evolved after this candidate was queued; retry to capture the new revision.')
        }
        if (currentSource.conflict) {
          const files = await conflictFiles(this.#executor, workspace.path, currentSource.changeId, input.signal)
          const conflict: ConflictRecord = {
            files: [...files],
            detectedAt: this.#now(),
            note: 'The source revision itself is conflicted. Resolve it in the source workspace, then retry.',
          }
          return this.#failCandidate(candidate, 'blocked', 'Source revision is conflicted.', { conflict })
        }
        if (await isRevisionEmpty(this.#executor, workspace.path, candidate.sourceRevision.changeId, input.signal)) {
          return this.#failCandidate(candidate, 'blocked', 'Source revision contains no changes; nothing to integrate.')
        }
        if (await isAncestor(this.#executor, repository.root, candidate.sourceRevision.commitId, spine.commitId, input.signal)) {
          return this.#integrateAlready(candidate, spine)
        }
        const startedAt = this.#now()
        const running = await this.#updateCandidate(candidate.id, current => ({
          ...current,
          state: 'running',
          error: null,
          updatedAt: startedAt,
          attempts: [...current.attempts, this.#newAttempt('running', startedAt, spine)],
        }), [
          this.#event('integration.started', {
            repositoryId: repository.id,
            workspaceId: workspace.id,
            sessionId: input.sessionId,
            candidateId: candidate.id,
            correlationId: candidate.correlationId,
            revisions: { source: candidate.sourceRevision, spineBefore: spine },
          }),
        ])
        let duplicated: ObservedRevision
        try {
          duplicated = await duplicateOnto({
            executor: this.#executor,
            cwd: repository.root,
            sourceRevision: candidate.sourceRevision.changeId,
            targetRevision: spine.changeId,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          })
        } catch (error) {
          const code = error instanceof JjCommandError && error.code === 'revision-not-found' ? 'stale' : 'failed'
          return this.#failCandidate(running, code === 'stale' ? 'stale' : 'failed', describeError(error))
        }
        if (duplicated.conflict) {
          const files = await conflictFiles(this.#executor, repository.root, duplicated.changeId, input.signal)
          const conflict: ConflictRecord = {
            files: [...files],
            detectedAt: this.#now(),
            note: 'Jujutsu reported a conflict when duplicating the source revision onto the canonical target. Resolve in the source workspace, then retry.',
          }
          const leak = await this.#abandonDuplicate(repository.root, duplicated, input.signal)
          return this.#failCandidate(running, 'blocked', 'Integration produced conflicts.', {
            resultRevision: toRevision(duplicated),
            conflict,
            spineBefore: spine,
            duplicateAbandoned: leak.abandoned,
            leakedRevision: leak.leakedRevision,
          })
        }
        let validation: ValidationRecord
        try {
          validation = await this.#validate(duplicated, repository.root, input.signal)
        } catch (error) {
          const leak = await this.#abandonDuplicate(repository.root, duplicated, input.signal)
          return this.#failCandidate(running, 'failed', describeError(error), {
            resultRevision: toRevision(duplicated),
            spineBefore: spine,
            duplicateAbandoned: leak.abandoned,
            leakedRevision: leak.leakedRevision,
          })
        }
        if (validation.kind === 'command' && validation.exitCode !== 0) {
          const leak = await this.#abandonDuplicate(repository.root, duplicated, input.signal)
          return this.#failCandidate(running, 'failed', 'Validation failed; the canonical bookmark was not advanced.', {
            resultRevision: toRevision(duplicated),
            validation,
            spineBefore: spine,
            duplicateAbandoned: leak.abandoned,
            leakedRevision: leak.leakedRevision,
          })
        }
        const advancedSpine = await this.#resolveOptional(repository.root, repository.spineBookmark, input.signal)
        if (advancedSpine === undefined || advancedSpine.commitId !== spine.commitId) {
          const leak = await this.#abandonDuplicate(repository.root, duplicated, input.signal)
          const moved = new IntegrationError(
            'spine-moved',
            `Canonical bookmark ${repository.spineBookmark} moved from ${spine.commitId} to ${advancedSpine?.commitId ?? 'nothing'} before the integration was recorded; nothing was advanced.`,
          )
          await this.#failCandidate(running, 'failed', moved.message, {
            resultRevision: toRevision(duplicated),
            validation,
            spineBefore: spine,
            duplicateAbandoned: leak.abandoned,
            leakedRevision: leak.leakedRevision,
          })
          throw moved
        }
        const targetIsDescendant = await isAncestor(this.#executor, repository.root, spine.commitId, duplicated.changeId, input.signal)
        try {
          await setBookmark(this.#executor, repository.root, repository.spineBookmark, duplicated.changeId, {
            allowBackwards: targetIsDescendant,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          })
        } catch (error) {
          const leak = await this.#abandonDuplicate(repository.root, duplicated, input.signal)
          return this.#failCandidate(running, 'failed', describeError(error), {
            resultRevision: toRevision(duplicated),
            validation,
            spineBefore: spine,
            duplicateAbandoned: leak.abandoned,
            leakedRevision: leak.leakedRevision,
          })
        }
        const advanced = await this.#resolveOptional(repository.root, repository.spineBookmark, input.signal)
        const finishedAt = this.#now()
        const integrated = await this.#updateCandidate(running.id, current => ({
          ...current,
          state: 'integrated',
          resultRevision: toRevision(duplicated),
          validation,
          conflict: null,
          error: null,
          updatedAt: finishedAt,
          attempts: replaceLastAttempt(current.attempts, {
            finishedAt,
            outcome: 'integrated',
            spineBefore: cleanRevision(spine),
            spineAfter: advanced === undefined ? null : toRevision(advanced),
            resultRevision: toRevision(duplicated),
            duplicateAbandoned: null,
            leakedRevision: null,
            conflicts: null,
            validation,
            error: null,
          }),
        }), [
          this.#event('integration.completed', {
            repositoryId: repository.id,
            workspaceId: workspace.id,
            sessionId: input.sessionId,
            candidateId: candidate.id,
            correlationId: candidate.correlationId,
            revisions: {
              source: candidate.sourceRevision,
              spineBefore: spine,
              spineAfter: advanced === undefined ? null : toRevision(advanced),
              result: toRevision(duplicated),
            },
            outcome: 'integrated',
          }),
        ])
        await this.#updateState(current => ({
          state: {
            ...current,
            workspaces: current.workspaces.map(item => (item.id === workspace.id ? { ...item, lifecycle: 'integrated', updatedAt: finishedAt } : item)),
          },
          value: undefined,
          events: [],
        }))
        return { outcome: 'integrated', candidate: integrated, detail: `Integrated as ${duplicated.changeId}.` }
      })
    })
  }

  async retryCandidate(id: string, sessionId: string | null, signal?: AbortSignal): Promise<IntegrationCandidate> {
    return this.#serialize(async () => {
      const state = await this.#readState()
      const candidate = state.candidates.find(item => item.id === id)
      if (candidate === undefined) throw new IntegrationError('candidate-not-found', 'Integration candidate is not registered.')
      this.#assertMayRun(candidate, sessionId)
      if (candidate.state === 'running') throw new IntegrationError('candidate-running', 'Candidate is currently running.')
      const workspace = state.workspaces.find(item => item.id === candidate.workspaceId)
      if (workspace === undefined || workspace.missing) throw new IntegrationError('workspace-missing', 'Source workspace is missing or unavailable.')
      const source = await resolveRevision(this.#executor, workspace.path, '@', signal)
      const now = this.#now()
      return this.#updateCandidate(id, current => ({
        ...current,
        state: 'queued',
        sourceRevision: toRevision(source),
        error: null,
        conflict: null,
        updatedAt: now,
        queuePosition: current.queuePosition,
      }), [
        this.#event('integration.queued', {
          repositoryId: candidate.repositoryId,
          workspaceId: candidate.workspaceId,
          sessionId,
          candidateId: candidate.id,
          correlationId: candidate.correlationId,
          revisions: { source: toRevision(source) },
          detail: 'retry',
        }),
      ])
    })
  }

  async cancelCandidate(id: string, sessionId: string | null): Promise<IntegrationCandidate> {
    return this.#serialize(async () => {
      const state = await this.#readState()
      const candidate = state.candidates.find(item => item.id === id)
      if (candidate === undefined) throw new IntegrationError('candidate-not-found', 'Integration candidate is not registered.')
      this.#assertMayRun(candidate, sessionId)
      if (candidate.state === 'integrated' || candidate.state === 'running') {
        throw new IntegrationError('candidate-not-cancellable', 'Only a queued, blocked, failed, or stale candidate can be cancelled.')
      }
      const now = this.#now()
      return this.#updateCandidate(id, current => ({ ...current, state: 'cancelled', updatedAt: now }), [
        this.#event('integration.cancelled', {
          repositoryId: candidate.repositoryId,
          workspaceId: candidate.workspaceId,
          sessionId,
          candidateId: candidate.id,
          correlationId: candidate.correlationId,
          revisions: { source: candidate.sourceRevision },
        }),
      ])
    })
  }

  async moveCandidate(id: string, direction: 'up' | 'down'): Promise<IntegrationCandidate> {
    return this.#serialize(() =>
      this.#updateState(state => {
        const candidate = state.candidates.find(item => item.id === id)
        if (candidate === undefined) throw new IntegrationError('candidate-not-found', 'Integration candidate is not registered.')
        const queue = [...state.candidates].filter(item => item.state === 'queued').sort((left, right) => left.queuePosition - right.queuePosition)
        const index = queue.findIndex(item => item.id === id)
        const neighbourIndex = direction === 'up' ? index - 1 : index + 1
        const neighbour = queue[neighbourIndex]
        if (index < 0 || neighbour === undefined) return { state, value: candidate, events: [] }
        const now = this.#now()
        const moved = { ...candidate, queuePosition: neighbour.queuePosition, updatedAt: now }
        const swapped = { ...neighbour, queuePosition: candidate.queuePosition, updatedAt: now }
        return {
          state: { ...state, candidates: state.candidates.map(item => (item.id === moved.id ? moved : item.id === swapped.id ? swapped : item)) },
          value: moved,
          events: [],
        }
      }),
    )
  }

  async #validate(revision: ObservedRevision, repositoryRoot: string, signal?: AbortSignal): Promise<ValidationRecord> {
    const command = this.#validationCommand
    if (command === undefined || this.#executeCommand === undefined) return noneValidation()
    const stagingPath = join(tmpdir(), `${STAGING_PREFIX}${revision.changeId.slice(0, 12)}-${randomUUID().slice(0, 8)}`)
    const stagingName = `${STAGING_PREFIX}${revision.changeId.slice(0, 12)}-${randomUUID().slice(0, 8)}`
    const journalPath = (await repositoryStatePaths(repositoryRoot)).stagingJournalPath
    await this.#appendStagingJournal(journalPath, { name: stagingName, path: stagingPath, createdAt: this.#now() })
    try {
      await addWorkspace({
        executor: this.#executor,
        cwd: repositoryRoot,
        path: stagingPath,
        name: stagingName,
        revision: revision.changeId,
        ...(signal === undefined ? {} : { signal }),
      })
      const result = await runValidationCommand({
        execute: this.#executeCommand,
        command,
        cwd: stagingPath,
        ...(signal === undefined ? {} : { signal }),
      })
      const output = `${result.stdout}\n${result.stderr}`.trim()
      return {
        kind: 'command',
        revision: toRevision(revision),
        command,
        exitCode: result.exitCode,
        outputExcerpt: output.slice(-2000),
        ranAt: this.#now(),
      }
    } finally {
      await forgetWorkspace(this.#executor, repositoryRoot, stagingName, signal).catch(() => undefined)
      await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined)
      await this.#removeStagingJournalEntry(journalPath, stagingName)
    }
  }

  async #reapStaging(repository: RepositoryRecord, signal?: AbortSignal): Promise<void> {
    const journalPath = (await repositoryStatePaths(repository.root)).stagingJournalPath
    const entries = await this.#readStagingJournal(journalPath)
    if (entries.length === 0) return
    const reaped: StagingJournalEntry[] = []
    const remaining: StagingJournalEntry[] = []
    for (const entry of entries) {
      const existed = await pathExists(entry.path)
      const forgotten = await forgetWorkspace(this.#executor, repository.root, entry.name, signal).catch(() => false)
      await rm(entry.path, { recursive: true, force: true }).catch(() => undefined)
      if (existed) reaped.push(entry)
      if (!forgotten && existed) remaining.push(entry)
    }
    if (remaining.length === 0) {
      await rm(journalPath, { force: true }).catch(() => undefined)
    } else {
      await atomicWriteFile(journalPath, `${JSON.stringify(remaining)}\n`)
    }
    if (reaped.length === 0) return
    await this.#updateState(state => ({
      state,
      value: undefined,
      events: reaped.map(entry =>
        this.#event('integration.staging_reaped', { repositoryId: repository.id, detail: `${entry.name} ${entry.path}` }),
      ),
    }))
  }

  async #readStagingJournal(path: string): Promise<readonly StagingJournalEntry[]> {
    try {
      const parsed = stagingJournalSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
      return parsed.success ? parsed.data : []
    } catch {
      return []
    }
  }

  async #appendStagingJournal(path: string, entry: StagingJournalEntry): Promise<void> {
    const entries = await this.#readStagingJournal(path)
    await atomicWriteFile(path, `${JSON.stringify([...entries, entry])}\n`)
  }

  async #removeStagingJournalEntry(path: string, name: string): Promise<void> {
    const remaining = (await this.#readStagingJournal(path)).filter(entry => entry.name !== name)
    if (remaining.length === 0) {
      await rm(path, { force: true }).catch(() => undefined)
      return
    }
    await atomicWriteFile(path, `${JSON.stringify(remaining)}\n`)
  }

  async #abandonDuplicate(
    cwd: string,
    duplicate: ObservedRevision,
    signal?: AbortSignal,
  ): Promise<{ readonly abandoned: boolean; readonly leakedRevision: JjRevision | null }> {
    const abandoned = await abandonRevision(this.#executor, cwd, duplicate.changeId, signal)
    if (abandoned && !(await revisionExists(this.#executor, cwd, duplicate.changeId, signal))) {
      return { abandoned: true, leakedRevision: null }
    }
    return { abandoned: false, leakedRevision: toRevision(duplicate) }
  }

  #assertMayRun(candidate: IntegrationCandidate, sessionId: string | null): void {
    if (sessionId === null) return
    if (this.#allowAnyAgentIntegration) return
    if (candidate.sourceSessionId === sessionId) return
    if (this.#coordinatorSessions.has(sessionId)) return
    throw new IntegrationError('integration-unauthorized', 'Only the candidate owner or a configured coordinator session may integrate this candidate.')
  }

  #newRepository(root: string, now: number): RepositoryRecord {
    return { id: randomUUID(), root, spineBookmark: this.#spineBookmark, createdAt: now, updatedAt: now }
  }

  #newWorkspace(input: { readonly repositoryId: string; readonly path: string; readonly now: number }): WorkspaceRecord {
    const name = input.path.split('/').filter(segment => segment.length > 0).slice(-1)[0] ?? input.path
    return {
      id: randomUUID(),
      repositoryId: input.repositoryId,
      name: name.slice(0, 128),
      path: input.path,
      lifecycle: 'created',
      currentRevision: null,
      owners: [],
      createdAt: input.now,
      updatedAt: input.now,
      lastObservedAt: null,
      missing: false,
      notes: null,
    }
  }

  #newAttempt(outcome: IntegrationAttempt['outcome'], startedAt: number, spine: JjRevision): IntegrationAttempt {
    return {
      startedAt,
      finishedAt: null,
      outcome,
      spineBefore: cleanRevision(spine),
      spineAfter: null,
      resultRevision: null,
      duplicateAbandoned: null,
      leakedRevision: null,
      conflicts: null,
      validation: noneValidation(),
      error: null,
    }
  }

  #event(
    type: IntegrationEventType,
    input: {
      readonly repositoryId?: string | null
      readonly workspaceId?: string | null
      readonly sessionId?: string | null
      readonly candidateId?: string | null
      readonly correlationId?: string | null
      readonly revisions?: Partial<IntegrationEvent['revisions']>
      readonly outcome?: string | null
      readonly detail?: string | null
    },
  ): IntegrationEvent {
    const event: IntegrationEvent = {
      id: randomUUID(),
      type,
      at: this.#now(),
      repositoryId: input.repositoryId ?? null,
      workspaceId: input.workspaceId ?? null,
      sessionId: input.sessionId ?? null,
      candidateId: input.candidateId ?? null,
      correlationId: input.correlationId ?? null,
      revisions: {
        source: cleanRevision(input.revisions?.source),
        spineBefore: cleanRevision(input.revisions?.spineBefore),
        spineAfter: cleanRevision(input.revisions?.spineAfter),
        result: cleanRevision(input.revisions?.result),
      },
      outcome: input.outcome ?? null,
      detail: input.detail ?? null,
    }
    this.#onEvent?.(event)
    return event
  }

  async #integrateAlready(candidate: IntegrationCandidate, spine: ObservedRevision): Promise<IntegrationRunResult> {
    const now = this.#now()
    const updated = await this.#updateCandidate(candidate.id, current => ({
      ...current,
      state: 'already-integrated',
      updatedAt: now,
      error: null,
      attempts: [
        ...current.attempts,
        {
          startedAt: now,
          finishedAt: now,
          outcome: 'already-integrated',
          spineBefore: toRevision(spine),
          spineAfter: toRevision(spine),
          resultRevision: null,
          duplicateAbandoned: null,
          leakedRevision: null,
          conflicts: null,
          validation: noneValidation(),
          error: null,
        },
      ],
    }), [
      this.#event('integration.already_integrated', {
        repositoryId: candidate.repositoryId,
        workspaceId: candidate.workspaceId,
        sessionId: candidate.sourceSessionId,
        candidateId: candidate.id,
        correlationId: candidate.correlationId,
        revisions: { source: candidate.sourceRevision, spineBefore: toRevision(spine) },
      }),
    ])
    return { outcome: 'already-integrated', candidate: updated, detail: 'Source revision is already part of the canonical target.' }
  }

  async #failCandidate(
    candidate: IntegrationCandidate,
    state: 'blocked' | 'failed' | 'stale',
    detail: string,
    extra: {
      readonly resultRevision?: JjRevision
      readonly conflict?: ConflictRecord
      readonly validation?: ValidationRecord
      readonly spineBefore?: JjRevision
      readonly duplicateAbandoned?: boolean
      readonly leakedRevision?: JjRevision | null
    } = {},
  ): Promise<IntegrationRunResult> {
    const now = this.#now()
    const validation = extra.validation ?? candidate.validation
    const updated = await this.#updateCandidate(candidate.id, current => ({
      ...current,
      state,
      resultRevision: extra.resultRevision ?? current.resultRevision,
      conflict: extra.conflict ?? (state === 'blocked' ? current.conflict : null),
      validation,
      error: detail,
      updatedAt: now,
      attempts: replaceLastAttempt(current.attempts, {
        finishedAt: now,
        outcome: state === 'blocked' ? 'blocked' : state === 'stale' ? 'stale' : 'failed',
        spineBefore: cleanRevision(extra.spineBefore),
        spineAfter: null,
        resultRevision: cleanRevision(extra.resultRevision),
        duplicateAbandoned: extra.duplicateAbandoned ?? null,
        leakedRevision: cleanRevision(extra.leakedRevision),
        conflicts: extra.conflict ?? null,
        validation,
        error: detail,
      }),
    }), [
      this.#event(
        state === 'blocked' ? 'integration.blocked' : state === 'stale' ? 'integration.stale' : validation.kind === 'command' && validation.exitCode !== 0 ? 'integration.validation_failed' : 'integration.failed',
        {
          repositoryId: candidate.repositoryId,
          workspaceId: candidate.workspaceId,
          sessionId: candidate.sourceSessionId,
          candidateId: candidate.id,
          correlationId: candidate.correlationId,
          revisions: { source: candidate.sourceRevision, spineBefore: extra.spineBefore ?? null, result: extra.resultRevision ?? null },
          outcome: state,
          detail,
        },
      ),
    ])
    return { outcome: updated.state === 'stale' ? 'stale' : state === 'blocked' ? 'blocked' : 'failed', candidate: updated, detail }
  }

  async #resolveOptional(cwd: string, revision: string, signal?: AbortSignal): Promise<ObservedRevision | undefined> {
    try {
      return await resolveRevision(this.#executor, cwd, revision, signal)
    } catch {
      return undefined
    }
  }

  async #updateCandidate(
    id: string,
    update: (candidate: IntegrationCandidate) => IntegrationCandidate,
    events: readonly IntegrationEvent[],
  ): Promise<IntegrationCandidate> {
    return this.#updateState(state => {
      const candidate = state.candidates.find(item => item.id === id)
      if (candidate === undefined) throw new IntegrationError('candidate-not-found', 'Integration candidate is not registered.')
      const next = update(candidate)
      return {
        state: { ...state, candidates: state.candidates.map(item => (item.id === id ? next : item)) },
        value: next,
        events,
      }
    })
  }

  async #updateState<T>(
    update: (state: JjIntegrationState) => { readonly state: JjIntegrationState; readonly value: T; readonly events: readonly IntegrationEvent[] },
  ): Promise<T> {
    const operation = this.#writes.then(async () => {
      const current = await this.#readState()
      const updated = update(current)
      const withEvents: JjIntegrationState = { ...updated.state, events: [...updated.state.events, ...updated.events].slice(-MAX_EVENTS) }
      const parsed = jjIntegrationStateSchema.parse(withEvents)
      const serialized = `${JSON.stringify(parsed)}\n`
      const directory = dirname(this.#statePath)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await atomicWriteFile(this.#statePath, serialized)
      return updated.value
    })
    this.#writes = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  async #readState(): Promise<JjIntegrationState> {
    let text: string
    try {
      text = await readFile(this.#statePath, 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return initialState()
      throw new IntegrationError('state-unreadable', 'Integration state is unreadable.')
    }
    try {
      return jjIntegrationStateSchema.parse(JSON.parse(text))
    } catch {
      throw new IntegrationError('state-invalid', 'Integration state is invalid; it was left untouched.')
    }
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutations.then(operation)
    this.#mutations = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async #withLock<T>(lockPath: string, operation: () => Promise<T>): Promise<T> {
    const token = await this.#acquireLock(lockPath)
    try {
      return await operation()
    } finally {
      await this.#releaseLock(lockPath, token)
    }
  }

  async #acquireLock(lockPath: string): Promise<string> {
    await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 })
    const token = randomUUID()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(lockPath, 'wx', 0o600)
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: this.#now(), token }))
        } finally {
          await handle.close()
        }
        return token
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
          throw new IntegrationError('lock-failed', 'Integration lock could not be acquired.')
        }
        if (attempt > 0 || !(await this.#lockIsStale(lockPath))) {
          throw new IntegrationError('integration-busy', 'Another integration is already in progress for this Jujutsu store.')
        }
        await unlink(lockPath).catch(() => undefined)
      }
    }
    throw new IntegrationError('integration-busy', 'Another integration is already in progress for this Jujutsu store.')
  }

  async #releaseLock(lockPath: string, token: string): Promise<void> {
    const raw = await this.#readLock(lockPath)
    if (raw?.token !== token) return
    await unlink(lockPath).catch(() => undefined)
  }

  async #readLock(lockPath: string): Promise<IntegrationLock | undefined> {
    try {
      const parsed = integrationLockSchema.safeParse(JSON.parse(await readFile(lockPath, 'utf8')))
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  async #lockIsStale(lockPath: string): Promise<boolean> {
    const raw = await this.#readLock(lockPath)
    if (raw === undefined) {
      // The file exists but does not parse: another process is between its
      // exclusive create and its write. Treat it as live until it stops changing,
      // otherwise two coordinators can both believe they hold the lock.
      const stats = await stat(lockPath).catch(() => undefined)
      if (stats === undefined) return true
      return this.#now() - stats.mtimeMs > LOCK_GRACE_MS
    }
    if (this.#now() - raw.startedAt > LOCK_TTL_MS) return true
    try {
      process.kill(raw.pid, 0)
      return false
    } catch {
      return true
    }
  }
}

const attachOwner = (
  owners: WorkspaceRecord['owners'],
  sessionId: string,
  source: 'session-cwd' | 'agent-tool' | 'human',
  now: number,
): WorkspaceRecord['owners'] => {
  const existing = owners.find(owner => owner.sessionId === sessionId)
  if (existing !== undefined) {
    return owners.map(owner => (owner.sessionId === sessionId ? { ...owner, detachedAt: null, source } : owner))
  }
  return [...owners, { sessionId, attachedAt: now, detachedAt: null, source }].slice(-64)
}

const atomicWriteFile = async (path: string, content: string): Promise<void> => {
  const temporaryPath = `${path}.tmp-${randomUUID()}`
  await writeFile(temporaryPath, content, { mode: 0o600 })
  await rename(temporaryPath, path)
}

const assertNoDependencyCycle = (candidates: readonly IntegrationCandidate[], candidateId: string, dependsOn: readonly string[]): void => {
  const edges = new Map<string, readonly string[]>(candidates.map(candidate => [candidate.id, candidate.dependsOn]))
  edges.set(candidateId, dependsOn)
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visited.has(id)) return
    if (visiting.has(id)) throw new IntegrationError('dependency-cycle', 'Candidate dependencies would form a cycle.')
    visiting.add(id)
    for (const dependencyId of edges.get(id) ?? []) visit(dependencyId)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of edges.keys()) visit(id)
}

const replaceLastAttempt = (attempts: readonly IntegrationAttempt[], patch: Partial<IntegrationAttempt>): IntegrationAttempt[] => {
  if (attempts.length === 0) return []
  const last = attempts[attempts.length - 1]
  if (last === undefined) return []
  return [...attempts.slice(0, -1), { ...last, ...patch }]
}

const statePriority: Readonly<Record<IntegrationCandidate['state'], number>> = {
  running: 0,
  blocked: 1,
  queued: 2,
  stale: 3,
  failed: 4,
  'already-integrated': 5,
  integrated: 6,
  cancelled: 7,
}

const compareCandidates = (left: IntegrationCandidate, right: IntegrationCandidate): number =>
  statePriority[left.state] - statePriority[right.state] ||
  left.queuePosition - right.queuePosition ||
  left.createdAt - right.createdAt

export const createJjIntegrationService = (input: {
  readonly executor: JjExecutor
  readonly executeCommand?: CommandExecutor
  readonly options?: JjIntegrationServiceOptions
}): JjIntegrationService => new JjIntegrationService(input)
