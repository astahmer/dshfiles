import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { SessionId as createSessionId } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId as createWorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import {
  assertCanonicalWorkspaceRoot,
  assertNoOverlappingWorkspaceRoots,
  assertNoSymlinkWorkspacePath,
  assertWorkspaceRestoreOwner,
  workspaceRootsOverlap,
  type WorkspaceRestoreOwner,
} from './workspace-restore-policy.ts'
import { WorkspaceRestoreStore, type WorkspaceRestoreJournal } from './workspace-restore-store.ts'
import type {
  SessionWorkspaceRestoreChangedPath,
  SessionWorkspaceRestoreConfirmRequest,
  SessionWorkspaceRestorePrepareRequest,
  SessionWorkspaceRestorePreview,
  SessionWorkspaceRestoreReceipt,
  SessionWorkspaceRestoreStatusRequest,
} from './types.ts'

const PREVIEW_TTL_MS = 60_000
const COMMAND_TIMEOUT_MS = 20_000
const PROCESS_EXIT_TIMEOUT_MS = 3_000
const MAX_OUTPUT_BYTES = 256 * 1024
const MAX_PREVIEW_PATHS = 200
const COMMIT_ID = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const workspaceListRow = z.tuple([z.string(), z.string().nullable()])
const changedPathRow = z.tuple([
  z.string().min(1),
  z.enum(['modified', 'added', 'removed', 'copied', 'renamed']),
])
const WORKSPACE_LIST_TEMPLATE = 'json(name) ++ "\\t" ++ json(root) ++ "\\n"'
const CHANGE_LIST_TEMPLATE = 'json(self.path().display()) ++ "\\t" ++ self.status() ++ "\\n"'

type RegisteredWorkspace = ReturnType<Context['workspaceRegistry']['list']>[number]
type RestoreAction = SessionWorkspaceRestorePrepareRequest['action']
type RestoreFailure = NonNullable<WorkspaceRestoreJournal['failure']>
type ProcessHandle = ReturnType<Context['subprocess']['spawn']>

interface RestorePreviewState {
  readonly action: RestoreAction
  readonly sessionId: SessionId
  readonly workspaceId: WorkspaceId
  readonly workspacePath: string
  readonly directoryIdentity: string
  readonly currentCommitId: string
  readonly savedCommitId: string
  readonly targetCommitId: string
  readonly attemptTargetCommitId: string
  readonly changedPaths: readonly SessionWorkspaceRestoreChangedPath[]
  readonly changedPathsTruncated: boolean
  readonly expiresAt: number
}

interface ActiveRestore {
  readonly root: string
  readonly sessionIds: ReadonlySet<string>
  readonly abortController: AbortController
  phase: 'running' | 'recovery'
  processQuiescence?: Promise<void>
}

interface WorkspaceAdmission {
  readonly root: string
  count: number
}

interface ProcessOutput {
  readonly stdout: string
  readonly truncated: boolean
}

class RestoreCommandFailure extends Error {
  constructor(
    readonly reason: RestoreFailure,
    readonly quiescent: boolean,
    readonly processQuiescence?: Promise<void>,
  ) {
    super('Jujutsu restore command failed')
  }
}

const badRequest = (message: string): RemoteError => new RemoteError('gateway/bad-request', message, {})

const directoryIdentity = async (root: string): Promise<string> => {
  try {
    await assertCanonicalWorkspaceRoot(root)
    const details = await stat(root, { bigint: true })
    if (!details.isDirectory()) throw new Error('Not a directory')
    return `${details.dev}:${details.ino}`
  } catch {
    throw badRequest('The workspace directory could not be verified as canonical.')
  }
}

const parseWorkspaceRoots = (stdout: string): string[] => {
  const roots: string[] = []
  for (const line of stdout.split('\n').filter(Boolean)) {
    const separator = line.indexOf('\t')
    if (separator < 0) throw new Error('Jujutsu workspace list could not be verified.')
    let name: unknown
    let root: unknown
    try {
      name = JSON.parse(line.slice(0, separator))
      root = JSON.parse(line.slice(separator + 1))
    } catch {
      throw new Error('Jujutsu workspace list could not be verified.')
    }
    const row = workspaceListRow.safeParse([name, root])
    if (!row.success || row.data[1] === null) throw new Error('Every Jujutsu workspace must have a recorded root.')
    roots.push(row.data[1])
  }
  if (roots.length === 0) throw new Error('Jujutsu has no verifiable workspace roots.')
  return roots
}

const normalizeRepoPath = (path: string): string => path.split(sep).join('/')

const parseChangedPaths = (stdout: string): SessionWorkspaceRestoreChangedPath[] => {
  const changedPaths: SessionWorkspaceRestoreChangedPath[] = []
  for (const line of stdout.split('\n').filter(Boolean)) {
    const separator = line.indexOf('\t')
    if (separator < 0) throw new Error('Jujutsu diff could not be verified.')
    let path: unknown
    try {
      path = JSON.parse(line.slice(0, separator))
    } catch {
      throw new Error('Jujutsu diff could not be verified.')
    }
    const row = changedPathRow.safeParse([path, line.slice(separator + 1)])
    if (!row.success) throw new Error('Jujutsu diff could not be verified.')
    changedPaths.push({ path: normalizeRepoPath(row.data[0]), status: row.data[1] })
  }
  return changedPaths
}

const safeWaitForExit = async (handle: ProcessHandle, timeoutMs: number): Promise<boolean> => {
  try {
    return await handle.waitForExit(AbortSignal.timeout(timeoutMs))
  } catch {
    return false
  }
}

const observeQuiescence = (handle: ProcessHandle): Promise<void> => handle.waitForExit().then((exited) => {
  if (!exited) throw new Error('The managed Jujutsu process range is still active.')
})

export class SessionWorkspaceRestoreController {
  private readonly store = new WorkspaceRestoreStore()
  private readonly previews = new Map<string, RestorePreviewState>()
  private readonly active = new Map<string, ActiveRestore>()
  private readonly workspaceAdmissions = new Map<string, WorkspaceAdmission>()
  private readonly activeTasks = new Set<Promise<void>>()
  private disposed = false
  readonly ready: Promise<void>

  constructor(private readonly ctx: Context) {
    this.ready = this.openAndRecover()
    ctx.effect(() => async () => this.dispose(), 'session-controller.workspace-restore')
    ctx.on('agent/status', ({ agent, status }) => {
      if (status !== 'running') return
      const sessionPath = this.ctx.get('sessions')?.get(agent.id)?.header.cwd
      for (const operation of this.active.values()) {
        if (
          operation.phase === 'running'
          && (operation.sessionIds.has(agent.id)
            || (sessionPath !== undefined && workspaceRootsOverlap(operation.root, resolve(sessionPath))))
        ) {
          operation.abortController.abort()
        }
      }
    })
  }

  private trackTask<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(badRequest('The filesystem restore service is shutting down.'))
    let finishTask = (): void => {}
    const activeTask = new Promise<void>(resolveTask => { finishTask = resolveTask })
    this.activeTasks.add(activeTask)
    return operation().finally(() => {
      this.activeTasks.delete(activeTask)
      finishTask()
    })
  }

  private async openAndRecover(): Promise<void> {
    await this.store.open(this.ctx.storageDomain)
    const pending = this.store.list().filter(journal =>
      journal.state === 'applying'
      || journal.state === 'rollback-applying'
      || journal.state === 'uncertain',
    )
    for (const journal of pending) {
      const workspace = this.ctx.get('workspaceRegistry')?.list().find(candidate => candidate.id === journal.workspaceId)
      this.active.set(journal.workspaceId, {
        root: journal.workspacePath,
        sessionIds: new Set([journal.sessionId, ...(workspace?.sessionIds ?? [])]),
        abortController: new AbortController(),
        phase: 'recovery',
      })
    }
    for (const journal of pending) {
      const operation = this.active.get(journal.workspaceId)
      if (operation === undefined) continue
      const reconciled = await this.reconcile(journal)
      this.updateRecoveryLock(journal.workspaceId, operation, reconciled)
    }
  }

  async prepare(
    request: SessionWorkspaceRestorePrepareRequest,
    signal: AbortSignal,
  ): Promise<SessionWorkspaceRestorePreview> {
    return this.trackTask(() => this.prepareOperation(request, signal))
  }

  private async prepareOperation(
    request: SessionWorkspaceRestorePrepareRequest,
    signal: AbortSignal,
  ): Promise<SessionWorkspaceRestorePreview> {
    await this.ready
    if (this.disposed) throw badRequest('The filesystem restore service is shutting down.')
    signal.throwIfAborted()
    const { workspace } = this.resolveOwner(request.sessionId)
    let activeOperation = this.active.get(workspace.id)
    if (activeOperation?.phase === 'running' || activeOperation?.processQuiescence !== undefined) {
      throw badRequest('A filesystem restore is still active for this workspace.')
    }

    let previous = await this.currentReceipt(workspace.id)
    if (previous !== undefined && this.needsReconciliation(previous)) {
      if (activeOperation === undefined) {
        activeOperation = {
          root: workspace.path,
          sessionIds: new Set(workspace.sessionIds),
          abortController: new AbortController(),
          phase: 'recovery',
        }
        this.active.set(workspace.id, activeOperation)
      }
      previous = await this.reconcile(previous, signal)
      this.updateRecoveryLock(workspace.id, activeOperation, previous)
      if (this.needsReconciliation(previous)) {
        throw badRequest('The previous filesystem restore is still being reconciled.')
      }
    }
    if (this.active.has(workspace.id)) {
      throw badRequest('The previous filesystem restore could not be safely reconciled.')
    }

    const directory = await this.verifyWorkspace(workspace, signal)
    const currentCommitId = await this.readCurrentCommit(workspace.path, directory.identity, signal)
    let savedCommitId = currentCommitId
    let targetCommitId = request.targetCommitId ?? ''
    let attemptTargetCommitId = targetCommitId

    if (request.action === 'restore') {
      if (previous !== undefined && (previous.state === 'partial' || previous.state === 'unchanged')) {
        throw badRequest('Recover the previous filesystem restore before starting another one.')
      }
      if (!COMMIT_ID.safeParse(targetCommitId).success) throw badRequest('Choose a full Jujutsu commit id from the current repository.')
      targetCommitId = await this.resolveCommit(workspace.path, directory.identity, targetCommitId, signal)
      attemptTargetCommitId = targetCommitId
    } else {
      if (previous === undefined || previous.sessionId !== request.sessionId) {
        throw badRequest('There is no recoverable filesystem restore for this Session.')
      }
      if (request.action === 'retry' && previous.state !== 'unchanged') {
        throw badRequest('Retry is available only when the earlier restore left the workspace unchanged.')
      }
      if (request.action === 'rollback' && previous.state !== 'partial') {
        throw badRequest('Rollback is available only after a partial filesystem restore.')
      }
      savedCommitId = previous.savedCommitId
      targetCommitId = previous.targetCommitId
      attemptTargetCommitId = request.action === 'rollback' ? savedCommitId : previous.attemptTargetCommitId
      if (request.action === 'retry' && !(await this.sameTree(
        workspace.path,
        directory.identity,
        previous.attemptBeforeCommitId,
        currentCommitId,
        signal,
      ))) {
        throw badRequest('The workspace changed after the failed restore; review a new restore preview first.')
      }
    }

    const changedPaths = await this.readChangedPaths(
      workspace.path,
      directory.identity,
      currentCommitId,
      attemptTargetCommitId,
      signal,
    )
    try {
      await Promise.all(changedPaths.paths.map(path => assertNoSymlinkWorkspacePath(workspace.path, path.path)))
    } catch {
      throw badRequest('The restore includes a path that crosses a symbolic link or cannot be verified.')
    }
    if (await this.readCurrentCommit(workspace.path, directory.identity, signal) !== currentCommitId) {
      throw badRequest('The workspace changed while the restore preview was being prepared; prepare it again.')
    }

    const expiresAt = Date.now() + PREVIEW_TTL_MS
    const previewId = randomUUID()
    this.previews.set(previewId, {
      action: request.action,
      sessionId: request.sessionId,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      directoryIdentity: directory.identity,
      currentCommitId,
      savedCommitId,
      targetCommitId,
      attemptTargetCommitId,
      changedPaths: changedPaths.paths.slice(0, MAX_PREVIEW_PATHS),
      changedPathsTruncated: changedPaths.paths.length > MAX_PREVIEW_PATHS,
      expiresAt,
    })
    return {
      previewId,
      action: request.action,
      sessionId: request.sessionId,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      currentCommitId,
      savedCommitId,
      targetCommitId: attemptTargetCommitId,
      changedPaths: changedPaths.paths.slice(0, MAX_PREVIEW_PATHS),
      changedPathsTruncated: changedPaths.paths.length > MAX_PREVIEW_PATHS,
      expiresAt,
    }
  }

  async confirm(
    request: SessionWorkspaceRestoreConfirmRequest,
    signal: AbortSignal,
  ): Promise<SessionWorkspaceRestoreReceipt> {
    await this.ready
    if (this.disposed) throw badRequest('The filesystem restore service is shutting down.')
    signal.throwIfAborted()
    const preview = this.previews.get(request.previewId)
    this.previews.delete(request.previewId)
    if (preview === undefined || preview.expiresAt <= Date.now()) {
      throw badRequest('Restore preview expired; prepare it again before confirming.')
    }
    if (preview.changedPathsTruncated) {
      throw badRequest('This restore preview omits paths, so it cannot be confirmed.')
    }

    const { workspace, owners } = this.resolveOwner(preview.sessionId)
    if (workspace.id !== preview.workspaceId || workspace.path !== preview.workspacePath) {
      throw badRequest('The Session workspace changed after the restore preview.')
    }
    if (this.active.has(workspace.id)) throw badRequest('A filesystem restore is already active for this workspace.')
    if (this.hasWorkspaceAdmissions(workspace.path)) {
      throw badRequest('Finish the current Session or workspace operation before restoring files.')
    }
    const ownerIds = new Set(owners.map(owner => owner.sessionId))
    const operation: ActiveRestore = {
      root: workspace.path,
      sessionIds: ownerIds,
      abortController: new AbortController(),
      phase: 'running',
    }
    this.active.set(workspace.id, operation)
    let finishTask = (): void => {}
    const activeTask = new Promise<void>(resolveTask => { finishTask = resolveTask })
    this.activeTasks.add(activeTask)
    let journal: WorkspaceRestoreJournal | undefined
    let journalPersisted = false
    try {
      const directory = await this.verifyWorkspace(workspace, signal)
      if (directory.identity !== preview.directoryIdentity) {
        throw badRequest('The workspace directory changed after the restore preview.')
      }
      const currentCommitId = await this.readCurrentCommit(workspace.path, directory.identity, signal)
      if (currentCommitId !== preview.currentCommitId) {
        throw badRequest('The workspace changed after the restore preview; prepare it again.')
      }

      const previous = await this.currentReceipt(workspace.id)
      if (preview.action === 'retry' && (previous?.state !== 'unchanged' || previous.sessionId !== preview.sessionId)) {
        throw badRequest('The previous restore is no longer eligible for retry.')
      }
      if (preview.action === 'rollback' && (previous?.state !== 'partial' || previous.sessionId !== preview.sessionId)) {
        throw badRequest('The previous restore is no longer eligible for rollback.')
      }

      const latestOwner = this.resolveOwner(preview.sessionId)
      const latestOwnerIds = new Set(latestOwner.owners.map(owner => owner.sessionId))
      if (
        latestOwner.workspace.id !== workspace.id
        || latestOwner.workspace.path !== workspace.path
        || latestOwnerIds.size !== ownerIds.size
        || [...ownerIds].some(ownerId => !latestOwnerIds.has(ownerId))
      ) {
        throw badRequest('Workspace Session ownership changed after the restore preview.')
      }

      const changedPaths = await this.readChangedPaths(
        workspace.path,
        directory.identity,
        currentCommitId,
        preview.attemptTargetCommitId,
        signal,
      )
      if (changedPaths.paths.length > MAX_PREVIEW_PATHS) {
        throw badRequest('This restore changes too many paths to confirm from a bounded preview.')
      }
      try {
        await Promise.all(changedPaths.paths.map(path => assertNoSymlinkWorkspacePath(workspace.path, path.path)))
      } catch {
        throw badRequest('The restore includes a path that crosses a symbolic link or cannot be verified.')
      }
      if (await this.readCurrentCommit(workspace.path, directory.identity, signal) !== currentCommitId) {
        throw badRequest('The workspace changed after the restore preview; prepare it again.')
      }

      journal = {
        operationId: randomUUID(),
        action: preview.action,
        sessionId: preview.sessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        directoryIdentity: directory.identity,
        savedCommitId: preview.savedCommitId,
        targetCommitId: preview.targetCommitId,
        attemptBeforeCommitId: currentCommitId,
        attemptTargetCommitId: preview.attemptTargetCommitId,
        state: preview.action === 'rollback' ? 'rollback-applying' : 'applying',
        currentCommitId,
        updatedAt: Date.now(),
      }
      await this.store.put(journal)
      journalPersisted = true
      try {
        await this.runJujutsu(
          workspace.path,
          directory.identity,
          ['restore', '--from', preview.attemptTargetCommitId, '--into', '@'],
          undefined,
          operation.abortController.signal,
        )
      } catch (error) {
        const failure = error instanceof RestoreCommandFailure ? error.reason : 'command-failed'
        const quiescent = !(error instanceof RestoreCommandFailure) || error.quiescent
        const failed: WorkspaceRestoreJournal = {
          ...journal,
          state: quiescent ? journal.state : 'uncertain',
          failure,
          updatedAt: Date.now(),
        }
        await this.store.put(failed)
        journal = failed
        if (!quiescent) {
          operation.phase = 'recovery'
          if (error instanceof RestoreCommandFailure && error.processQuiescence !== undefined) {
            operation.processQuiescence = error.processQuiescence
            const recoveryTask = this.reconcileAfterQuiescence(workspace.id, operation)
            this.activeTasks.add(recoveryTask)
            void recoveryTask.finally(() => this.activeTasks.delete(recoveryTask))
          }
          return this.toReceipt(failed)
        }
      }

      const current = this.store.get(workspace.id) ?? journal
      const reconciled = await this.reconcile(current)
      this.updateRecoveryLock(workspace.id, operation, reconciled)
      return this.toReceipt(reconciled)
    } catch (error) {
      if (!journalPersisted || journal === undefined) throw error
      const current = this.store.get(workspace.id) ?? journal
      const uncertain: WorkspaceRestoreJournal = {
        ...current,
        state: 'uncertain',
        failure: 'verification-failed',
        updatedAt: Date.now(),
      }
      try {
        await this.store.put(uncertain)
      } catch {
        operation.phase = 'recovery'
        return this.toReceipt(uncertain)
      }
      operation.phase = 'recovery'
      this.updateRecoveryLock(workspace.id, operation, uncertain)
      return this.toReceipt(uncertain)
    } finally {
      if (operation.phase === 'running' && this.active.get(workspace.id) === operation) {
        this.active.delete(workspace.id)
      }
      this.activeTasks.delete(activeTask)
      finishTask()
    }
  }

  async status(
    request: SessionWorkspaceRestoreStatusRequest,
    signal: AbortSignal,
  ): Promise<SessionWorkspaceRestoreReceipt | null> {
    return this.trackTask(() => this.statusOperation(request, signal))
  }

  private async statusOperation(
    request: SessionWorkspaceRestoreStatusRequest,
    signal: AbortSignal,
  ): Promise<SessionWorkspaceRestoreReceipt | null> {
    await this.ready
    if (this.disposed) throw badRequest('The filesystem restore service is shutting down.')
    signal.throwIfAborted()
    const journal = this.store.list()
      .filter(candidate => candidate.sessionId === request.sessionId)
      .sort((first, second) => second.updatedAt - first.updatedAt)[0]
    if (journal === undefined) return null
    let operation = this.active.get(journal.workspaceId)
    if (operation?.phase === 'running' || operation?.processQuiescence !== undefined) {
      return this.toReceipt(journal)
    }
    if (operation === undefined && this.needsReconciliation(journal)) {
      operation = {
        root: journal.workspacePath,
        sessionIds: new Set([journal.sessionId]),
        abortController: new AbortController(),
        phase: 'recovery',
      }
      this.active.set(journal.workspaceId, operation)
    }
    const reconciled = await this.reconcile(journal, signal)
    if (operation !== undefined) {
      this.updateRecoveryLock(journal.workspaceId, operation, reconciled)
    }
    return this.toReceipt(reconciled)
  }

  assertSessionAvailable(sessionId: SessionId): void {
    const session = this.ctx.get('sessions')?.get(sessionId)
    for (const operation of this.active.values()) {
      if (
        operation.sessionIds.has(sessionId)
        || (session?.header.cwd !== undefined && workspaceRootsOverlap(operation.root, resolve(session.header.cwd)))
      ) {
        throw badRequest('This Session workspace is locked while a filesystem restore is running.')
      }
    }
  }

  beginWorkspaceAccess(workspaceId?: WorkspaceId, cwd?: string): () => void {
    const workspace = workspaceId === undefined ? undefined : this.ctx.get('workspaceRegistry')?.get(workspaceId)
    const requestedRoot = workspace?.path ?? resolve(cwd ?? process.cwd())
    let root = requestedRoot
    try {
      root = realpathSync(requestedRoot)
    } catch {
      root = resolve(requestedRoot)
    }
    this.assertWorkspacePathAvailable(workspaceId, root)
    const key = workspaceId ?? root
    const admission = this.workspaceAdmissions.get(key)
    if (admission === undefined) this.workspaceAdmissions.set(key, { root, count: 1 })
    else admission.count += 1
    let released = false
    return () => {
      if (released) return
      released = true
      const current = this.workspaceAdmissions.get(key)
      if (current === undefined || current.count <= 1) this.workspaceAdmissions.delete(key)
      else current.count -= 1
    }
  }

  beginSessionAccess(sessionId: SessionId): () => void {
    this.assertSessionAvailable(sessionId)
    const workspace = this.ctx.get('workspaceRegistry')?.list().find(candidate => candidate.sessionIds.includes(sessionId))
    if (workspace !== undefined) return this.beginWorkspaceAccess(workspace.id, workspace.path)
    const cwd = this.ctx.get('sessions')?.get(sessionId)?.header.cwd
    if (cwd !== undefined) return this.beginWorkspaceAccess(undefined, cwd)
    return () => {}
  }

  async assertWorkspaceAvailable(workspaceId?: WorkspaceId, cwd?: string): Promise<void> {
    const workspace = workspaceId === undefined ? undefined : this.ctx.get('workspaceRegistry')?.get(workspaceId)
    const candidatePath = workspace?.path ?? await this.resolveDirectory(cwd ?? process.cwd())
    this.assertWorkspacePathAvailable(workspaceId, candidatePath)
  }

  private assertWorkspacePathAvailable(workspaceId: WorkspaceId | undefined, candidatePath: string): void {
    for (const [id, operation] of this.active) {
      if (id === workspaceId || workspaceRootsOverlap(operation.root, candidatePath)) {
        throw badRequest('This workspace is locked while a filesystem restore is running.')
      }
    }
  }

  private hasWorkspaceAdmissions(root: string): boolean {
    return [...this.workspaceAdmissions.values()].some(admission => workspaceRootsOverlap(admission.root, root))
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const operation of this.active.values()) {
      if (operation.phase === 'running') operation.abortController.abort()
    }
    await Promise.allSettled([this.ready])
    while (this.activeTasks.size > 0) {
      await Promise.allSettled([...this.activeTasks])
    }
    await this.store.close()
  }

  private resolveOwner(sessionId: SessionId): { workspace: RegisteredWorkspace; owners: WorkspaceRestoreOwner[] } {
    const workspaces = this.ctx.workspaceRegistry.list()
    const matches = workspaces.filter(workspace => workspace.sessionIds.includes(sessionId))
    if (matches.length !== 1) throw badRequest('Restore requires a Session attached to exactly one registered workspace.')
    const workspace = matches[0]
    if (workspace === undefined) throw badRequest('Restore requires a registered Session workspace.')
    const archivedSessionIds = this.ctx.workspaceRegistry.archivedSessionIds
    const owners = workspace.sessionIds.map(ownerSessionId => ({
      sessionId: ownerSessionId,
      archived: archivedSessionIds.includes(ownerSessionId),
      running: this.ctx.agents.get(ownerSessionId)?.status === 'running',
    }))
    try {
      assertWorkspaceRestoreOwner(sessionId, owners)
    } catch (error) {
      if (error instanceof Error) throw badRequest(error.message)
      throw badRequest('Workspace Session ownership could not be verified.')
    }
    return { workspace, owners }
  }

  private async verifyWorkspace(
    workspace: RegisteredWorkspace,
    signal: AbortSignal,
  ): Promise<{ identity: string }> {
    const identity = await directoryIdentity(workspace.path)
    const rootOutput = await this.runJujutsu(workspace.path, identity, ['root', '--ignore-working-copy'], signal)
    if (rootOutput.truncated || rootOutput.stdout.trim() !== workspace.path) {
      throw badRequest('The Session workspace is not the exact root of its Jujutsu working copy.')
    }

    const listOutput = await this.runJujutsu(
      workspace.path,
      identity,
      ['workspace', 'list', '--ignore-working-copy', '--template', WORKSPACE_LIST_TEMPLATE],
      signal,
    )
    if (listOutput.truncated) throw badRequest('Jujutsu workspace roots could not be listed completely.')
    const jjRoots = parseWorkspaceRoots(listOutput.stdout)
    if (!jjRoots.includes(workspace.path)) throw badRequest('The selected Session workspace is not a registered Jujutsu workspace.')

    const otherRoots = [
      ...this.ctx.workspaceRegistry.list()
        .filter(candidate => candidate.id !== workspace.id)
        .map(candidate => candidate.path),
      ...jjRoots.filter(root => root !== workspace.path),
    ]
    try {
      await Promise.all(otherRoots.map(root => assertCanonicalWorkspaceRoot(root)))
      assertNoOverlappingWorkspaceRoots(workspace.path, otherRoots)
    } catch (error) {
      if (error instanceof Error) throw badRequest(error.message)
      throw badRequest('Overlapping workspace roots could not be verified.')
    }
    return { identity }
  }

  private async readCurrentCommit(root: string, identity: string, signal?: AbortSignal): Promise<string> {
    const output = await this.runJujutsu(root, identity, ['log', '--no-graph', '-r', '@', '--template', 'commit_id'], signal)
    const commitId = output.stdout.trim()
    if (output.truncated || !COMMIT_ID.safeParse(commitId).success) {
      throw new RemoteError('gateway/internal', 'The current Jujutsu working-copy revision could not be verified.', {})
    }
    return commitId
  }

  private async resolveCommit(
    root: string,
    identity: string,
    commitId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const output = await this.runJujutsu(
      root,
      identity,
      ['log', '--ignore-working-copy', '--no-graph', '-r', commitId, '--template', 'commit_id'],
      signal,
    )
    const resolved = output.stdout.trim()
    if (output.truncated || resolved !== commitId) throw badRequest('The selected full commit id is not present in this repository.')
    return resolved
  }

  private async readChangedPaths(
    root: string,
    identity: string,
    fromCommitId: string,
    toCommitId: string,
    signal: AbortSignal,
  ): Promise<{ paths: SessionWorkspaceRestoreChangedPath[] }> {
    const typeOutput = await this.runJujutsu(root, identity, [
      'diff', '--ignore-working-copy', '--from', fromCommitId, '--to', toCommitId, '--types',
    ], signal)
    if (typeOutput.truncated) throw badRequest('The restore diff is too large to verify safely.')
    const typePairs = typeOutput.stdout.split('\n').filter(Boolean).map(line => line.slice(0, 2))
    if (typePairs.some(pair => !/^[-FLGC]{2}$/.test(pair))) {
      throw new RemoteError('gateway/internal', 'The Jujutsu diff type output could not be verified.', {})
    }
    if (typePairs.some(pair => pair.includes('L'))) {
      throw badRequest('Restore cannot change a symbolic-link path.')
    }

    const pathOutput = await this.runJujutsu(root, identity, [
      'diff', '--ignore-working-copy', '--from', fromCommitId, '--to', toCommitId,
      '--template', CHANGE_LIST_TEMPLATE,
    ], signal)
    if (pathOutput.truncated) throw badRequest('The restore path list is too large to verify safely.')
    let paths: SessionWorkspaceRestoreChangedPath[]
    try {
      paths = parseChangedPaths(pathOutput.stdout)
    } catch {
      throw new RemoteError('gateway/internal', 'The Jujutsu restore path list could not be verified.', {})
    }
    if (paths.length !== typePairs.length) {
      throw new RemoteError('gateway/internal', 'Jujutsu returned inconsistent restore path summaries.', {})
    }
    return { paths }
  }

  private async sameTree(
    root: string,
    identity: string,
    sourceCommitId: string,
    currentCommitId: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const output = await this.runJujutsu(root, identity, [
      'diff', '--ignore-working-copy', '--from', sourceCommitId, '--to', currentCommitId, '--summary',
    ], signal)
    return !output.truncated && output.stdout.trim().length === 0
  }

  private async currentReceipt(workspaceId: WorkspaceId): Promise<WorkspaceRestoreJournal | undefined> {
    return this.store.get(workspaceId)
  }

  private async reconcile(
    journal: WorkspaceRestoreJournal,
    signal?: AbortSignal,
  ): Promise<WorkspaceRestoreJournal> {
    if (!this.needsReconciliation(journal)) return journal
    try {
      const currentIdentity = await directoryIdentity(journal.workspacePath)
      if (currentIdentity !== journal.directoryIdentity) {
        const state: WorkspaceRestoreJournal['state'] = 'uncertain'
        const failure: RestoreFailure = 'workspace-changed'
        const changed = { ...journal, state, failure, updatedAt: Date.now() }
        await this.store.put(changed)
        return changed
      }
      const rootOutput = await this.runJujutsu(
        journal.workspacePath,
        journal.directoryIdentity,
        ['root', '--ignore-working-copy'],
        signal,
      )
      if (rootOutput.truncated || rootOutput.stdout.trim() !== journal.workspacePath) {
        throw new Error('The restore workspace root no longer matches its durable receipt.')
      }
      const currentCommitId = await this.readCurrentCommit(journal.workspacePath, journal.directoryIdentity, signal)
      const reachedTarget = await this.sameTree(
        journal.workspacePath,
        journal.directoryIdentity,
        journal.attemptTargetCommitId,
        currentCommitId,
        signal,
      )
      const unchanged = !reachedTarget && await this.sameTree(
        journal.workspacePath,
        journal.directoryIdentity,
        journal.attemptBeforeCommitId,
        currentCommitId,
        signal,
      )
      const retryingRollback = journal.action === 'retry'
        && journal.attemptTargetCommitId === journal.savedCommitId
        && journal.targetCommitId !== journal.savedCommitId
      const state: WorkspaceRestoreJournal['state'] = reachedTarget
        ? journal.action === 'rollback' || retryingRollback ? 'rolled-back' : 'complete'
        : unchanged
          ? 'unchanged'
          : 'partial'
      const failure = state === 'complete' || state === 'rolled-back'
        ? undefined
        : journal.failure ?? 'verification-failed'
      const reconciled = {
        ...journal,
        state,
        ...(failure === undefined ? { failure: undefined } : { failure }),
        currentCommitId,
        updatedAt: Date.now(),
      }
      await this.store.put(reconciled)
      return reconciled
    } catch {
      const failure: RestoreFailure = journal.failure ?? 'verification-failed'
      const uncertain: WorkspaceRestoreJournal = {
        ...journal,
        state: 'uncertain',
        failure,
        updatedAt: Date.now(),
      }
      await this.store.put(uncertain)
      return uncertain
    }
  }

  private needsReconciliation(journal: WorkspaceRestoreJournal): boolean {
    return journal.state === 'applying'
      || journal.state === 'rollback-applying'
      || journal.state === 'uncertain'
  }

  private updateRecoveryLock(
    workspaceId: string,
    operation: ActiveRestore,
    journal: WorkspaceRestoreJournal,
  ): void {
    if (this.active.get(workspaceId) !== operation) return
    if (this.needsReconciliation(journal)) {
      operation.phase = 'recovery'
      return
    }
    this.active.delete(workspaceId)
  }

  private async reconcileAfterQuiescence(workspaceId: WorkspaceId, operation: ActiveRestore): Promise<void> {
    try {
      const processQuiescence = operation.processQuiescence
      if (processQuiescence === undefined) return
      await processQuiescence
      delete operation.processQuiescence
      if (this.disposed || this.active.get(workspaceId) !== operation) return
      const journal = await this.currentReceipt(workspaceId)
      if (journal === undefined) return
      const reconciled = await this.reconcile(journal)
      this.updateRecoveryLock(workspaceId, operation, reconciled)
    } catch {
      operation.phase = 'recovery'
    }
  }

  private toReceipt(journal: WorkspaceRestoreJournal): SessionWorkspaceRestoreReceipt {
    return {
      operationId: journal.operationId,
      action: journal.action,
      sessionId: createSessionId(journal.sessionId),
      workspaceId: createWorkspaceId(journal.workspaceId),
      savedCommitId: journal.savedCommitId,
      targetCommitId: journal.targetCommitId,
      state: journal.state,
      ...(journal.currentCommitId === undefined ? {} : { currentCommitId: journal.currentCommitId }),
      ...(journal.failure === undefined ? {} : { failure: journal.failure }),
      updatedAt: journal.updatedAt,
      canRetry: journal.state === 'unchanged',
      canRollback: journal.state === 'partial',
    }
  }

  private async resolveDirectory(path: string): Promise<string> {
    try {
      const canonicalPath = await realpath(resolve(path))
      if (!(await stat(canonicalPath)).isDirectory()) throw new Error('Not a directory')
      return canonicalPath
    } catch {
      return resolve(path)
    }
  }

  private async runJujutsu(
    root: string,
    expectedIdentity: string,
    args: readonly string[],
    signal?: AbortSignal,
    operationSignal?: AbortSignal,
  ): Promise<ProcessOutput> {
    signal?.throwIfAborted()
    operationSignal?.throwIfAborted()
    const commandController = new AbortController()
    let timedOut = false
    let callerCancelled = false
    let handle: ProcessHandle | undefined
    const abortFromSignal = (): void => {
      callerCancelled = true
      commandController.abort()
    }
    const abortFromOperation = (): void => {
      callerCancelled = true
      commandController.abort()
    }
    signal?.addEventListener('abort', abortFromSignal, { once: true })
    operationSignal?.addEventListener('abort', abortFromOperation, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      commandController.abort()
    }, COMMAND_TIMEOUT_MS)
    try {
      if (await directoryIdentity(root) !== expectedIdentity) throw new RestoreCommandFailure('workspace-changed', true)
      const executable = await this.ctx.subprocess.resolveExecutable('jj', undefined, commandController.signal)
      if (!isAbsolute(executable) || executable.includes('\0')) throw new RestoreCommandFailure('command-failed', true)
      if (await directoryIdentity(root) !== expectedIdentity) throw new RestoreCommandFailure('workspace-changed', true)
      handle = this.ctx.subprocess.spawn({
        argv: [executable, '--color=never', '--no-pager', ...args],
        cwd: root,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: MAX_OUTPUT_BYTES },
          stderr: { maxBytes: 4_096 },
        },
        graceMs: 1_000,
        signal: commandController.signal,
      })

      let abortListener: (() => void) | undefined
      const aborted = new Promise<{ readonly kind: 'aborted' }>(resolveAbort => {
        abortListener = () => resolveAbort({ kind: 'aborted' })
        if (commandController.signal.aborted) abortListener()
        else commandController.signal.addEventListener('abort', abortListener, { once: true })
      })
      const completed = handle.done.then(
        outcome => ({ kind: 'complete' as const, exitCode: outcome.exitCode }),
        () => ({ kind: 'failed' as const }),
      )
      const result = await Promise.race([completed, aborted])
      if (abortListener !== undefined) commandController.signal.removeEventListener('abort', abortListener)
      if (result.kind === 'aborted') {
        handle.terminate()
        const quiescent = await safeWaitForExit(handle, PROCESS_EXIT_TIMEOUT_MS)
        throw new RestoreCommandFailure(
          timedOut ? 'timeout' : callerCancelled ? 'cancelled' : 'command-failed',
          quiescent,
          quiescent ? undefined : observeQuiescence(handle),
        )
      }
      if (result.kind === 'failed') {
        handle.terminate()
        const quiescent = await safeWaitForExit(handle, PROCESS_EXIT_TIMEOUT_MS)
        throw new RestoreCommandFailure(
          'command-failed',
          quiescent,
          quiescent ? undefined : observeQuiescence(handle),
        )
      }
      if (!(await safeWaitForExit(handle, PROCESS_EXIT_TIMEOUT_MS))) {
        handle.terminate()
        const quiescent = await safeWaitForExit(handle, PROCESS_EXIT_TIMEOUT_MS)
        throw new RestoreCommandFailure(
          'process-not-quiescent',
          quiescent,
          quiescent ? undefined : observeQuiescence(handle),
        )
      }
      if (result.exitCode !== 0) throw new RestoreCommandFailure('command-failed', true)
      const output = handle.collected.stdout?.readFrom(0)
      if (output === undefined) throw new RestoreCommandFailure('verification-failed', true)
      if (await directoryIdentity(root) !== expectedIdentity) throw new RestoreCommandFailure('workspace-changed', true)
      return { stdout: output.text, truncated: output.lossy }
    } catch (error) {
      if (error instanceof RestoreCommandFailure) throw error
      handle?.terminate()
      const quiescent = handle === undefined || await safeWaitForExit(handle, PROCESS_EXIT_TIMEOUT_MS)
      const processQuiescence = handle === undefined || quiescent ? undefined : observeQuiescence(handle)
      if (timedOut) throw new RestoreCommandFailure('timeout', quiescent, processQuiescence)
      if (callerCancelled || signal?.aborted === true) {
        throw new RestoreCommandFailure('cancelled', quiescent, processQuiescence)
      }
      throw new RestoreCommandFailure('command-failed', quiescent, processQuiescence)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abortFromSignal)
      operationSignal?.removeEventListener('abort', abortFromOperation)
    }
  }
}
