import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { JjExecutor } from './jj.js'

/**
 * Provisioning for the smallest vertical slice: a coding thread gets its own
 * independent jj workspace, based on a frozen commit id, or it gets a refusal.
 *
 * There is deliberately no fallback to the shared checkout: a thread that cannot
 * be given an isolated workspace is reported as such, because silently running in
 * the repository root is the failure this slice exists to prevent.
 */

export const UNSAFE_MARKER = 'jj-isolation-unsafe.json'

/**
 * `jj workspace add` mutates one shared store, so concurrent adds contend on the
 * same op-log and working-copy locks. Serializing per repository is deterministic
 * and needs no retry policy; the chain never rejects, so one failure cannot strand
 * the queue for that repository.
 */
const queues = new Map<string, Promise<unknown>>()

const withRepositoryLock = <T>(key: string, operation: () => Promise<T>): Promise<T> => {
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.then(operation, operation)
  queues.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

export type ProvisionStatus =
  | 'created'
  | 'existing'
  | 'refused-unsafe'
  | 'refused-collision'
  | 'refused-base'
  | 'not-a-jj-repository'
  | 'failed'

export interface ProvisionOutcome {
  readonly status: ProvisionStatus
  readonly sessionId: string
  readonly workspaceName: string
  readonly path: string | null
  readonly baseCommitId: string | null
  readonly reason: string | null
}

export interface ExistingBinding {
  readonly workspaceName: string
  readonly path: string
}

/** Stable, collision-resistant workspace name for a thread: slug plus a session digest. */
export const workspaceNameFor = (input: { readonly threadName: string; readonly sessionId: string }): string => {
  const slug = input.threadName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  const digest = createHash('sha256').update(input.sessionId).digest('hex').slice(0, 8)
  return `${slug.length === 0 ? 'thread' : slug}-${digest}`
}

const run = async (executor: JjExecutor, args: readonly string[], cwd: string) => {
  const result = await executor({ args, cwd })
  return { ...result, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

const WORKSPACE_LIST_TEMPLATE = 'name ++ "\\t" ++ target.commit_id() ++ "\\t" ++ target.parents().map(|p| p.commit_id()).join(",") ++ "\\n"'

interface WorkspaceHead {
  readonly name: string
  readonly commitId: string
  readonly parentIds: readonly string[]
}

/** Live workspace heads, or undefined when jj could not be read — never a silent empty list. */
const workspaceHeads = async (executor: JjExecutor, cwd: string): Promise<readonly WorkspaceHead[] | undefined> => {
  const result = await run(executor, ['--ignore-working-copy', 'workspace', 'list', '-T', WORKSPACE_LIST_TEMPLATE], cwd)
  if (result.exitCode !== 0) return undefined
  return result.stdout
    .split('\n')
    .filter(line => line.includes('\t'))
    .map(line => {
      const [name = '', commitId = '', parents = ''] = line.split('\t')
      return { name, commitId, parentIds: parents.split(',').filter(parent => parent.length > 0) }
    })
}

const readUnsafe = (repoRoot: string): readonly string[] => {
  const path = join(repoRoot, '.jj', 'repo', UNSAFE_MARKER)
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { unavailableForNewWork?: unknown }
    return Array.isArray(parsed.unavailableForNewWork)
      ? parsed.unavailableForNewWork.filter((value): value is string => typeof value === 'string')
      : []
  } catch {
    return []
  }
}

export interface ProvisionRequest {
  readonly executor: JjExecutor
  readonly repoRoot: string
  readonly workspacesDirectory: string
  readonly threadName: string
  readonly sessionId: string
  /** Revision the new workspace starts from; resolved to a full commit id. */
  readonly spineRevision: string
  readonly existing?: ExistingBinding | undefined
}

interface ProvisionBase {
  readonly sessionId: string
  readonly workspaceName: string
  readonly path: string | null
  readonly baseCommitId: string | null
  readonly reason: string | null
}

/**
 * Idempotent: an already-bound session returns its binding without running jj.
 * Otherwise the workspace is created from a frozen commit id, or the call is
 * refused with a reason. Every refusal leaves the filesystem untouched.
 */
export const provisionThreadWorkspace = async (request: ProvisionRequest): Promise<ProvisionOutcome> => {
  const workspaceName = request.existing?.workspaceName ?? workspaceNameFor(request)
  const base: ProvisionBase = {
    sessionId: request.sessionId,
    workspaceName,
    path: request.existing?.path ?? null,
    baseCommitId: null,
    reason: null,
  }

  if (request.existing !== undefined) return { ...base, status: 'existing' }

  const root = await run(request.executor, ['--ignore-working-copy', 'root'], request.repoRoot)
  if (root.exitCode !== 0 || root.stdout.length === 0) {
    return { ...base, status: 'not-a-jj-repository', reason: root.stderr || 'not inside a Jujutsu repository' }
  }
  const repositoryRoot = resolve(root.stdout)
  return withRepositoryLock(repositoryRoot, () => provisionInRepository(request, base, workspaceName, repositoryRoot))
}

const provisionInRepository = async (
  request: ProvisionRequest,
  base: ProvisionBase,
  workspaceName: string,
  repositoryRoot: string,
): Promise<ProvisionOutcome> => {
  if (readUnsafe(repositoryRoot).includes(workspaceName)) {
    return { ...base, status: 'refused-unsafe', reason: 'workspace is recorded as unavailable for new coding work' }
  }

  const destination = join(request.workspacesDirectory, workspaceName)
  if (existsSync(destination)) {
    return { ...base, path: destination, status: 'refused-collision', reason: `destination already exists: ${destination}` }
  }

  const resolved = await run(request.executor, ['--ignore-working-copy', 'log', '-r', request.spineRevision, '--no-graph', '-T', 'commit_id'], repositoryRoot)
  const baseCommitId = resolved.stdout.split('\n')[0]?.trim() ?? ''
  if (resolved.exitCode !== 0 || baseCommitId.length === 0) {
    return { ...base, status: 'refused-base', reason: `base revision does not resolve: ${request.spineRevision}` }
  }
  // A base another live workspace is sitting on would stack this thread's mutable
  // @ onto that workspace's lineage, which is the coupling this slice removes.
  const headsBefore = await workspaceHeads(request.executor, repositoryRoot)
  if (headsBefore === undefined) {
    return { ...base, baseCommitId, status: 'failed', reason: 'could not read the workspace list before provisioning' }
  }
  if (headsBefore.some(entry => entry.commitId === baseCommitId)) {
    return {
      ...base,
      baseCommitId,
      status: 'refused-base',
      reason: 'base revision is the working copy of a live workspace; use the canonical spine commit instead',
    }
  }

  // `jj workspace add` does not create parent directories, and this runs after
  // every refusal that must leave the filesystem untouched.
  mkdirSync(dirname(destination), { recursive: true })
  const created = await run(request.executor, ['workspace', 'add', destination, '--name', workspaceName, '-r', baseCommitId], repositoryRoot)
  const after = await workspaceHeads(request.executor, repositoryRoot)
  const registered = after?.find(entry => entry.name === workspaceName)
  // A non-zero exit is not proof of no side effects: `workspace add` registers the
  // workspace and only then checks out. A successful exit is not proof of a correct
  // placement either. Accept only a registration that matches on name, path and the
  // frozen base as the new working copy's parent; never delete anything on the way out.
  const confirmed = registered !== undefined && registered.parentIds.includes(baseCommitId) && existsSync(destination)
  if (confirmed) {
    return {
      status: 'created',
      sessionId: request.sessionId,
      workspaceName,
      path: destination,
      baseCommitId,
      reason:
        created.exitCode === 0
          ? null
          : 'jj reported a failure but the workspace is registered at the expected path and base; accepted after reconciliation',
    }
  }
  if (created.exitCode === 0) {
    return {
      ...base,
      baseCommitId,
      status: 'failed',
      reason: `jj reported success but the workspace registration did not verify (${registered === undefined ? 'not registered' : `base ${registered.commitId}`})`,
    }
  }
  return { ...base, baseCommitId, status: 'failed', reason: created.stderr || `jj workspace add exited ${String(created.exitCode)}` }
}
