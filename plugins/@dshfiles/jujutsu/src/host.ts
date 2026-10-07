import { waitForManagedExit } from '@dshfiles/dshx/host'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { createHash, randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative } from 'node:path'
import { defineHost } from '@dshfiles/dshx/host'
import { jujutsuApi, revisionSchema, type JujutsuState, type Mutation, type Revision } from './api.js'
import {
  buildMutationArgv,
  isCommitId,
  isRecordedJjGitPush,
  isSafeSplitPath,
  parseJsonLines,
  parsePatchStats,
  PreviewStore,
  redactRemoteOutput,
  validatedRepositoryPath,
  type PreparedMutation,
} from './core.js'
import { EVOLUTION_TEMPLATE, OPERATION_TEMPLATE, REVISION_TEMPLATE } from './jj-templates.js'
import { resolveWorkspaceDestination, sameWorkspaceParent } from './workspace-path.js'

const MAX_OUTPUT = 1_160_000
const MAX_STDERR = 64_000
const COMMAND_TIMEOUT = 30_000
const NETWORK_TIMEOUT = 120_000
const PREVIEW_TTL = 5 * 60_000
const MAX_REVISIONS = 500

interface RegisteredRepo {
  readonly id: string
  readonly root: string
  readonly identity: string
}

interface Snapshot {
  readonly state: JujutsuState
  readonly identity: string
  readonly fingerprint: string
}

interface ProcessResult {
  readonly stdout: string
  readonly truncated: boolean
}

const repos = new Map<string, RegisteredRepo>()
const previews = new PreviewStore()
let fixedJjExecutable: Promise<string> | undefined

const identityAt = async (path: string): Promise<string> => {
  const canonical = await realpath(path)
  if (canonical !== path) throw new Error('Registered repository path changed through a symlink.')
  const facts = await stat(canonical, { bigint: true })
  if (!facts.isDirectory()) throw new Error('Selected repository path is not a directory.')
  return String(facts.dev) + ':' + String(facts.ino)
}

const assertRepoIdentity = async (repo: RegisteredRepo): Promise<void> => {
  let current: string
  try {
    current = await identityAt(repo.root)
  } catch {
    throw new Error('Registered repository path is unavailable. Select it again.')
  }
  if (current !== repo.identity) throw new Error('Registered repository directory changed. Select it again.')
}

const resolveJjExecutable = async (ctx: Context, signal: AbortSignal): Promise<string> => {
  if (fixedJjExecutable === undefined) {
    const pending = ctx.subprocess.resolveExecutable('jj', undefined, signal).then(executable => {
      if (!isAbsolute(executable) || executable.includes('\0')) throw new Error('Jujutsu executable could not be resolved safely.')
      return executable
    })
    const shared = pending.catch(error => {
      if (fixedJjExecutable === shared) fixedJjExecutable = undefined
      throw error
    })
    fixedJjExecutable = shared
  }
  return fixedJjExecutable
}

const runAt = async (
  ctx: Context,
  cwd: string,
  expectedIdentity: string | undefined,
  args: readonly string[],
  signal: AbortSignal | undefined,
  options: { readonly outputLimit?: number; readonly timeoutMs?: number } = {},
): Promise<ProcessResult> => {
  const controller = new AbortController()
  let timedOut = false
  const forwardAbort = (): void => controller.abort()
  if (signal?.aborted === true) controller.abort()
  else signal?.addEventListener('abort', forwardAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs ?? COMMAND_TIMEOUT)
  let handle: ReturnType<typeof ctx.subprocess.spawn> | undefined
  try {
    const executable = await resolveJjExecutable(ctx, controller.signal)
    const before = await identityAt(cwd)
    if (expectedIdentity !== undefined && before !== expectedIdentity) throw new Error('Repository identity changed before command start.')
    handle = ctx.subprocess.spawn({
      argv: [executable, '--color=never', '--no-pager', ...args],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: options.outputLimit ?? MAX_OUTPUT },
        stderr: { maxBytes: MAX_STDERR },
      },
      graceMs: 1_500,
      signal: controller.signal,
      // Omit env so DSH subprocess scrubbing remains authoritative.
    })
    const outcome = await handle.done
    if (controller.signal.aborted) {
      handle.terminate()
      if (signal?.aborted === true) throw new Error('Jujutsu request was cancelled.')
      if (timedOut) throw new Error('Jujutsu command timed out.')
      throw new Error('Jujutsu command was cancelled.')
    }
    if (!(await waitForManagedExit({ handle, timeoutMs: options.timeoutMs ?? COMMAND_TIMEOUT, signal: controller.signal }))) {
      handle.terminate()
      throw new Error('Jujutsu process group did not exit.')
    }
    const output = handle.collected.stdout?.readFrom(0)
    if (output === undefined) throw new Error('Jujutsu output stream was unavailable.')
    if (outcome.exitCode !== 0) throw new Error('Jujutsu command failed with exit code ' + (outcome.exitCode ?? 'signal') + '.')
    const after = await identityAt(cwd)
    if (expectedIdentity !== undefined && after !== expectedIdentity) throw new Error('Repository directory changed during command execution.')
    return { stdout: output.text, truncated: output.lossy }
  } catch (error) {
    handle?.terminate()
    if (signal?.aborted === true) throw new Error('Jujutsu request was cancelled.')
    if (timedOut) throw new Error('Jujutsu command timed out.')
    if (error instanceof Error && /^(Choose |Invalid |Registered |Selected |Split |Jujutsu |Repository )/.test(error.message)) throw error
    // Never surface stderr: remote helpers can print credential-bearing URLs.
    throw new Error('Jujutsu could not run in the selected repository.')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

const registerRepo = async (ctx: Context, selectedPath: string, signal: AbortSignal | undefined): Promise<RegisteredRepo> => {
  const selected = validatedRepositoryPath(selectedPath)
  let canonicalSelection: string
  try {
    canonicalSelection = await realpath(selected)
  } catch {
    throw new Error('Selected repository path does not exist.')
  }
  if (!isAbsolute(canonicalSelection) || normalize(canonicalSelection) !== canonicalSelection) {
    throw new Error('Selected repository path is not canonical.')
  }
  const selectionIdentity = await identityAt(canonicalSelection)
  const rootOutput = await runAt(ctx, canonicalSelection, selectionIdentity, ['root'], signal, { outputLimit: 16_000 })
  const rootLine = rootOutput.stdout.trim()
  if (rootOutput.truncated || rootLine.length === 0 || rootLine.includes('\n') || !isAbsolute(rootLine)) {
    throw new Error('Jujutsu did not confirm a repository root for this directory.')
  }
  let root: string
  try {
    root = await realpath(validatedRepositoryPath(rootLine))
  } catch {
    throw new Error('Jujutsu returned an unavailable repository root.')
  }
  const identity = await identityAt(root)
  const selectionWithinRoot = relative(root, canonicalSelection)
  if (selectionWithinRoot === '..' || selectionWithinRoot.startsWith('../') || isAbsolute(selectionWithinRoot)) {
    throw new Error('Jujutsu returned a repository root outside the selected directory tree.')
  }
  const repo: RegisteredRepo = { id: randomUUID(), root, identity }
  const confirmed = await runAt(ctx, root, identity, ['root'], signal, { outputLimit: 16_000 })
  if (confirmed.truncated || (await realpath(confirmed.stdout.trim())) !== root) throw new Error('Repository root changed during registration.')
  await assertRepoIdentity(repo)
  while (repos.size >= 32) {
    const oldest = repos.keys().next().value as string | undefined
    if (oldest === undefined) break
    repos.delete(oldest)
  }
  repos.set(repo.id, repo)
  return repo
}

const resolveRepo = async (ctx: Context, repoId: string, signal: AbortSignal | undefined): Promise<RegisteredRepo> => {
  const repo = repos.get(repoId)
  if (repo === undefined) throw new Error('Repository registration expired. Select it again.')
  await assertRepoIdentity(repo)
  const confirmation = await runAt(ctx, repo.root, repo.identity, ['root'], signal, { outputLimit: 16_000 })
  const reportedRoot = confirmation.stdout.trim()
  if (confirmation.truncated || !isAbsolute(reportedRoot) || (await realpath(reportedRoot)) !== repo.root) {
    throw new Error('Registered path no longer resolves to the selected Jujutsu repository.')
  }
  await assertRepoIdentity(repo)
  return repo
}

const readRevisions = async (ctx: Context, repo: RegisteredRepo, limit: number, signal: AbortSignal | undefined): Promise<Revision[]> => {
  const result = await runAt(
    ctx,
    repo.root,
    repo.identity,
    ['log', '--no-graph', '--limit', String(limit), '--revisions', 'all()', '--template', REVISION_TEMPLATE],
    signal,
  )
  if (result.truncated) throw new Error('Revision graph exceeded the bounded output limit.')
  return parseJsonLines(result.stdout, value => revisionSchema.parse(value))
}

const readEvolvedCommitIds = async (
  ctx: Context,
  repo: RegisteredRepo,
  revisions: readonly Revision[],
  signal: AbortSignal | undefined,
): Promise<{ readonly commitIds: ReadonlySet<string>; readonly truncated: boolean }> => {
  if (revisions.length === 0) return { commitIds: new Set(), truncated: false }
  try {
    const result = await runAt(
      ctx,
      repo.root,
      repo.identity,
      ['evolog', '--no-graph', '--revisions', revisions.map(revision => revision.commitId).join('|'), '--limit', '1500', '--template', EVOLUTION_TEMPLATE],
      signal,
      { outputLimit: 512_000 },
    )
    const completeOutput = result.truncated ? result.stdout.slice(0, result.stdout.lastIndexOf('\n') + 1) : result.stdout
    const rows = parseJsonLines(completeOutput, value => {
      if (typeof value !== 'object' || value === null) throw new Error('Invalid evolution record.')
      const row = value as { commitId?: unknown; predecessors?: unknown }
      if (
        !isCommitId(String(row.commitId ?? '')) ||
        !Array.isArray(row.predecessors) ||
        !row.predecessors.every(id => typeof id === 'string' && isCommitId(id))
      ) {
        throw new Error('Invalid evolution record.')
      }
      return { commitId: row.commitId as string, predecessors: row.predecessors as string[] }
    })
    return {
      commitIds: new Set(rows.filter(row => row.predecessors.length > 0).map(row => row.commitId)),
      truncated: result.truncated || rows.length >= 1500,
    }
  } catch {
    if (signal?.aborted === true) throw new Error('Jujutsu request was cancelled.')
    return { commitIds: new Set(), truncated: true }
  }
}

const readPaths = async (ctx: Context, repo: RegisteredRepo, revision: string, signal: AbortSignal | undefined): Promise<string[]> => {
  const result = await runAt(ctx, repo.root, repo.identity, ['diff', '--revisions', revision, '--name-only'], signal, { outputLimit: 256_000 })
  if (result.truncated) throw new Error('Changed file list exceeded the bounded output limit.')
  return result.stdout
    .split(/\r?\n/)
    .filter(path => path.length > 0)
    .slice(0, 1000)
}

const readRemotes = async (
  ctx: Context,
  repo: RegisteredRepo,
  signal: AbortSignal | undefined,
): Promise<{ readonly names: string[]; readonly configFingerprint: string }> => {
  try {
    const result = await runAt(ctx, repo.root, repo.identity, ['git', 'remote', 'list'], signal, { outputLimit: 32_000 })
    if (result.truncated) return { names: [], configFingerprint: 'truncated' }
    const names = result.stdout.split(/\r?\n/).flatMap(line => {
      const name = line.trim().split(/\s+/, 1)[0]
      return name !== undefined && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(name) ? [name] : []
    })
    return {
      names: [...new Set(names)].slice(0, 64),
      // Keep remote URLs out of API responses while binding previews to their exact configuration.
      configFingerprint: createHash('sha256').update(result.stdout).digest('hex'),
    }
  } catch {
    return { names: [], configFingerprint: 'unavailable' }
  }
}

const readLastPush = async (
  ctx: Context,
  repo: RegisteredRepo,
  signal: AbortSignal | undefined,
): Promise<{ at: string | null; description: string | null; historyTruncated: boolean }> => {
  try {
    const result = await runAt(
      ctx,
      repo.root,
      repo.identity,
      ['--at-operation=@', '--ignore-working-copy', 'operation', 'log', '--no-graph', '--limit', '1000', '--template', OPERATION_TEMPLATE],
      signal,
      { outputLimit: 512_000 },
    )
    const completeOutput = result.truncated ? result.stdout.slice(0, result.stdout.lastIndexOf('\n') + 1) : result.stdout
    const operations = parseJsonLines(completeOutput, value => {
      if (typeof value !== 'object' || value === null) throw new Error('Invalid operation row.')
      const row = value as { description?: unknown; attributes?: unknown; time?: unknown }
      if (typeof row.description !== 'string' || typeof row.attributes !== 'string' || typeof row.time !== 'string') throw new Error('Invalid operation row.')
      return { attributes: row.attributes, time: row.time }
    })
    const push = operations.find(row => isRecordedJjGitPush(row.attributes))
    return {
      at: push?.time ?? null,
      description: push === undefined ? null : 'Recorded JJ git push command invocation',
      historyTruncated: result.truncated || operations.length >= 1000,
    }
  } catch {
    return { at: null, description: null, historyTruncated: true }
  }
}

const snapshot = async (ctx: Context, repo: RegisteredRepo, limit: number, signal: AbortSignal | undefined): Promise<Snapshot> => {
  const [revisions, status, changedPaths, remotes, lastPush] = await Promise.all([
    readRevisions(ctx, repo, limit, signal),
    runAt(ctx, repo.root, repo.identity, ['status'], signal, { outputLimit: 78_000 }),
    readPaths(ctx, repo, '@', signal),
    readRemotes(ctx, repo, signal),
    readLastPush(ctx, repo, signal),
  ])
  const evolution = await readEvolvedCommitIds(ctx, repo, revisions, signal)
  const graphRevisions = revisions.map(revision => ({ ...revision, evolved: evolution.commitIds.has(revision.commitId) }))
  await assertRepoIdentity(repo)
  const state: JujutsuState = {
    root: repo.root,
    revisions: graphRevisions,
    status: status.truncated ? status.stdout + '\n[status output truncated]' : status.stdout,
    changedPaths,
    remoteNames: remotes.names,
    lastPushAt: lastPush.at,
    lastPushDescription: lastPush.description,
    lastPushHistoryTruncated: lastPush.historyTruncated,
    evolutionHistoryTruncated: evolution.truncated,
  }
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        revisions: graphRevisions,
        changedPaths,
        status: state.status,
        remoteConfig: remotes.configFingerprint,
      }),
    )
    .digest('hex')
  return { state, identity: repo.identity, fingerprint }
}

const findRevision = (revisions: readonly Revision[], commitId: string): Revision => {
  if (!isCommitId(commitId)) throw new Error('Invalid revision id.')
  const row = revisions.find(revision => revision.commitId === commitId)
  if (row === undefined) throw new Error('Revision is no longer visible. Refresh and try again.')
  return row
}

const mutationPreview = (action: Mutation, revisions: readonly Revision[], selectedPaths: readonly string[], workspacePath?: string) => {
  switch (action.kind) {
    case 'describe': {
      const revision = findRevision(revisions, action.commitId)
      if (revision.immutable) throw new Error('Jujutsu marks this revision immutable.')
      return {
        title: 'Update description',
        summary: 'Change ' + revision.shortestChangeId + ' description',
        detail: 'Current:\n' + (revision.description || '(empty)') + '\n\nNew:\n' + action.message,
      }
    }
    case 'split': {
      const revision = findRevision(revisions, action.commitId)
      if (revision.immutable) throw new Error('Jujutsu marks this revision immutable.')
      if (!action.paths.every(path => isSafeSplitPath(path) && selectedPaths.includes(path))) {
        throw new Error('Split files must be selected from this revision and use safe literal paths.')
      }
      return {
        title: 'Split revision',
        summary: 'Split ' + revision.shortestChangeId + ' by selected files',
        detail: 'Files:\n' + action.paths.join('\n') + '\n\nNew revision description:\n' + action.message,
      }
    }
    case 'squash': {
      const source = findRevision(revisions, action.sourceId)
      const destination = findRevision(revisions, action.destinationId)
      if (source.immutable || destination.immutable) throw new Error('Jujutsu marks a selected revision immutable.')
      return {
        title: 'Squash changes',
        summary: 'Move ' + source.shortestChangeId + ' into ' + destination.shortestChangeId,
        detail:
          'Source: ' +
          (source.description || '(empty)') +
          '\nDestination: ' +
          (destination.description || '(empty)') +
          '\n\nResulting description:\n' +
          action.message,
      }
    }
    case 'rebase': {
      const source = findRevision(revisions, action.sourceId)
      const destination = findRevision(revisions, action.destinationId)
      if (source.immutable) throw new Error('Jujutsu marks the source revision immutable.')
      if (source.commitId === destination.commitId) throw new Error('Choose two different visible revisions to rebase.')
      return {
        title: 'Rebase revision',
        summary: 'Rebase ' + source.shortestChangeId + ' onto ' + destination.shortestChangeId,
        detail: 'Jujutsu will rebase this revision and its descendants. Conflicts remain recorded in the repository for review.',
      }
    }
    case 'bookmark-move': {
      const destination = findRevision(revisions, action.destinationId)
      const current = revisions.find(revision => revision.localBookmarks.includes(action.bookmark))
      if (current === undefined) throw new Error('Bookmark is no longer present. Refresh and try again.')
      return {
        title: 'Move bookmark',
        summary: 'Move ' + action.bookmark + ' to ' + destination.shortestChangeId,
        detail:
          'Current target: ' + current.shortestChangeId + '\nNew target: ' + destination.shortestChangeId + '\n\nBackward and sideways movement is enabled.',
      }
    }
    case 'fetch':
      return {
        title: 'Fetch remote',
        summary: 'Fetch from ' + action.remote,
        detail: 'JJ will update remote bookmarks and tags using configured fetch refspecs. Exact incoming changes depend on the remote response.',
      }
    case 'push':
      return {
        title: 'Push bookmark',
        summary: 'Push ' + action.bookmark + ' to ' + action.remote,
        detail: 'JJ dry-run preview follows. The real push starts only after confirmation.',
      }
    case 'workspace-add': {
      const revision = findRevision(revisions, action.commitId)
      if (workspacePath === undefined) throw new Error('Workspace destination was not validated.')
      return {
        title: 'Create isolated workspace',
        summary: 'Add ' + action.name + ' at ' + revision.shortestChangeId,
        detail:
          'Destination: ' +
          workspacePath +
          '\nBase: ' +
          revision.shortestChangeId +
          ' (' +
          revision.commitId +
          ')' +
          '\nThe current workspace and its working files remain in place.',
      }
    }
  }
}

const prepareMutation = async (
  ctx: Context,
  repo: RegisteredRepo,
  current: Snapshot,
  action: Mutation,
  signal: AbortSignal | undefined,
): Promise<PreparedMutation> => {
  let preparedAction = action
  let workspacePath: string | undefined
  let workspaceParentIdentity: { readonly device: string; readonly inode: string } | undefined
  if (action.kind === 'workspace-add') {
    const destination = await resolveWorkspaceDestination(repo.root, action.parentPath, action.name)
    preparedAction = { ...action, parentPath: destination.parentPath }
    workspacePath = destination.path
    workspaceParentIdentity = destination.parentIdentity
  }
  const paths = preparedAction.kind === 'split' ? await readPaths(ctx, repo, preparedAction.commitId, signal) : current.state.changedPaths
  const preview = mutationPreview(preparedAction, current.state.revisions, paths, workspacePath)
  const argv = buildMutationArgv(preparedAction)
  let detail = preview.detail
  if (preparedAction.kind === 'fetch' || preparedAction.kind === 'push') {
    if (!current.state.remoteNames.includes(preparedAction.remote)) throw new Error('Remote is no longer configured. Refresh and select a listed remote.')
  }
  if (preparedAction.kind === 'push') {
    if (!current.state.revisions.some(row => row.localBookmarks.includes(preparedAction.bookmark)))
      throw new Error('Bookmark is no longer present. Refresh and choose a listed bookmark.')
    try {
      const dryRun = await runAt(
        ctx,
        repo.root,
        repo.identity,
        ['git', 'push', '--dry-run', '--remote', preparedAction.remote, '--bookmark', preparedAction.bookmark],
        signal,
        { timeoutMs: NETWORK_TIMEOUT },
      )
      detail +=
        '\n\n' + (redactRemoteOutput(dryRun.stdout, 7000) || 'JJ reported no dry-run output.') + (dryRun.truncated ? '\n[dry-run output truncated]' : '')
    } catch {
      if (signal?.aborted === true) throw new Error('Jujutsu request was cancelled.')
      detail += '\n\nRemote dry-run unavailable. No push has occurred; the real push requires confirmation.'
    }
  }
  if (detail.length > 7_800) detail = detail.slice(0, 7_760) + '\n[preview detail truncated]'
  return {
    root: repo.root,
    identity: current.identity,
    fingerprint: current.fingerprint,
    action: preparedAction,
    ...(workspaceParentIdentity === undefined ? {} : { workspaceParentIdentity }),
    argv,
    title: preview.title,
    summary: preview.summary,
    detail,
    expiresAt: Date.now() + PREVIEW_TTL,
  }
}

const jujutsuHostApi = jujutsuApi.host({
  registerRepository: async ({ input, ctx, signal }) => {
    const repo = await registerRepo(ctx, input.path, signal)
    return { repoId: repo.id, root: repo.root }
  },
  load: async ({ input, ctx, signal }) => {
    const repo = await resolveRepo(ctx, input.repoId, signal)
    return (await snapshot(ctx, repo, input.limit, signal)).state
  },
  details: async ({ input, ctx, signal }) => {
    const repo = await resolveRepo(ctx, input.repoId, signal)
    const revisions = await readRevisions(ctx, repo, MAX_REVISIONS, signal)
    findRevision(revisions, input.commitId)
    const paths = await readPaths(ctx, repo, input.commitId, signal)
    const patch = await runAt(ctx, repo.root, repo.identity, ['diff', '--revisions', input.commitId, '--git'], signal)
    const evolution = await runAt(ctx, repo.root, repo.identity, ['evolog', '--no-graph', '--revisions', input.commitId, '--limit', '30'], signal, {
      outputLimit: 118_000,
    })
    const files = parsePatchStats(patch.stdout, paths, patch.truncated)
    return {
      files,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      patch: patch.truncated ? patch.stdout + '\n[diff truncated at the output limit]' : patch.stdout,
      truncated: patch.truncated,
      evolution: evolution.truncated ? evolution.stdout + '\n[evolution output truncated]' : evolution.stdout,
    }
  },
  workingDiff: async ({ input, ctx, signal }) => {
    const repo = await resolveRepo(ctx, input.repoId, signal)
    const patch = await runAt(ctx, repo.root, repo.identity, ['diff', '--revisions', '@', '--git'], signal)
    return { patch: patch.truncated ? patch.stdout + '\n[diff truncated at the output limit]' : patch.stdout, truncated: patch.truncated }
  },
  prepare: async ({ input, ctx, signal }) => {
    const repo = await resolveRepo(ctx, input.repoId, signal)
    const current = await snapshot(ctx, repo, MAX_REVISIONS, signal)
    const prepared = await prepareMutation(ctx, repo, current, input.action, signal)
    const id = randomUUID()
    previews.put(id, prepared)
    return { id, kind: input.action.kind, title: prepared.title, summary: prepared.summary, detail: prepared.detail, expiresAt: prepared.expiresAt }
  },
  confirm: async ({ input, ctx, signal }) => {
    const repo = await resolveRepo(ctx, input.repoId, signal)
    const current = await snapshot(ctx, repo, MAX_REVISIONS, signal)
    const prepared = previews.take(input.previewId, repo.root, repo.identity, current.fingerprint)
    if (prepared === undefined) throw new Error('Preview expired or repository state changed. Refresh and preview again.')
    await assertRepoIdentity(repo)
    let workspacePath: string | null = null
    if (prepared.action.kind === 'workspace-add') {
      const destination = await resolveWorkspaceDestination(repo.root, prepared.action.parentPath, prepared.action.name)
      const expectedPath = join(prepared.action.parentPath, prepared.action.name)
      if (
        prepared.workspaceParentIdentity === undefined ||
        !sameWorkspaceParent(prepared.workspaceParentIdentity, destination.parentIdentity) ||
        destination.parentPath !== prepared.action.parentPath ||
        destination.path !== expectedPath
      ) {
        throw new Error('Workspace destination changed after preview. Prepare the action again.')
      }
      workspacePath = destination.path
    }
    const result = await runAt(ctx, repo.root, repo.identity, prepared.argv, signal, {
      timeoutMs: prepared.action.kind === 'fetch' || prepared.action.kind === 'push' ? NETWORK_TIMEOUT : COMMAND_TIMEOUT,
    })
    await assertRepoIdentity(repo)
    const output = redactRemoteOutput(result.stdout, 11_000)
    return {
      message: prepared.title + ' completed.',
      output: output + (result.truncated ? '\n[command output truncated]' : ''),
      workspacePath,
    }
  },
})

export default defineHost({
  name: '@dshfiles/jujutsu',
  inject: ['subprocess', 'webServer'],
  apis: [jujutsuHostApi],
})
