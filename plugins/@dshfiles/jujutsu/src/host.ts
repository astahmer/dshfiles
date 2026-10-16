import { defineHost, definePromptSection, waitForManagedExit } from '@dshfiles/dshx/host'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { createHash, randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative } from 'node:path'
import { jujutsuApi, revisionSchema, type JujutsuState, type Mutation, type Revision } from './api.js'
import {
  buildMutationArgv,
  isCommitId,
  isRecordedJjGitPush,
  isSafeSplitPath,
  parseJsonLines,
  PreviewStore,
  redactRemoteOutput,
  validatedRepositoryPath,
  type PreparedMutation,
} from './core.js'
import { EVOLUTION_TEMPLATE, OPERATION_TEMPLATE, REVISION_TEMPLATE } from './jj-templates.js'
import { RevisionReads, type JjRun } from './revision-reads.js'
import { readGraphNavigation, readGraphSlice, readRevisionRelationship } from './graph-navigation-reads.js'
import { composerContextHost } from './composer-context-host.js'
import { jujutsuSettings } from './settings.js'
import { resolveWorkspaceDestination, sameWorkspaceParent } from './workspace-path.js'
import { graphPageRevset } from './graph-page.js'
import { matchesRevisionSearch } from './graph.js'

const MAX_OUTPUT = 1_160_000
const MAX_STDERR = 64_000
const COMMAND_TIMEOUT = 30_000
const NETWORK_TIMEOUT = 120_000
const PREVIEW_TTL = 5 * 60_000
const MAX_REVISIONS = 500
const INITIAL_GRAPH_PAGE_SIZE = 100
const MAX_WORKSPACE_HEAD_CANDIDATES = 32

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

const repoRun =
  (ctx: Context, repo: RegisteredRepo, signal: AbortSignal | undefined): JjRun =>
  (args, options) =>
    runAt(ctx, repo.root, repo.identity, args, signal, options)

const readRevisions = async (
  ctx: Context,
  repo: RegisteredRepo,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<{ readonly revisions: Revision[]; readonly hasMore: boolean }> => {
  const result = await runAt(
    ctx,
    repo.root,
    repo.identity,
    [RevisionReads.ignoreWorkingCopy, 'log', '--no-graph', '--limit', String(limit + 1), '--revisions', 'all()', '--template', REVISION_TEMPLATE],
    signal,
  )
  if (result.truncated) throw new Error('Revision graph exceeded the bounded output limit.')
  const revisions = parseJsonLines(result.stdout, value => revisionSchema.parse(value))
  return { revisions: revisions.slice(0, limit), hasMore: revisions.length > limit }
}

const readGraphPage = async (
  ctx: Context,
  repo: RegisteredRepo,
  query: string,
  excludeCommitIds: readonly string[],
  signal: AbortSignal | undefined,
): Promise<{ readonly revisions: Revision[]; readonly hasMore: boolean }> => {
  const result = await runAt(
    ctx,
    repo.root,
    repo.identity,
    [
      RevisionReads.ignoreWorkingCopy,
      'log',
      '--no-graph',
      '--limit',
      String(INITIAL_GRAPH_PAGE_SIZE + MAX_WORKSPACE_HEAD_CANDIDATES + 1),
      '--revisions',
      graphPageRevset({ query, excludeCommitIds }),
      '--template',
      REVISION_TEMPLATE,
    ],
    signal,
  )
  if (result.truncated) throw new Error('Revision graph exceeded the bounded output limit.')
  const revisions = parseJsonLines(result.stdout, value => revisionSchema.parse(value)).filter(revision => matchesRevisionSearch(revision, query))
  const page = revisions.slice(0, INITIAL_GRAPH_PAGE_SIZE)
  const evolution = await readEvolvedCommitIds(ctx, repo, page, signal)
  return {
    revisions: page.map(revision => ({ ...revision, evolved: evolution.commitIds.has(revision.commitId) })),
    hasMore: revisions.length > INITIAL_GRAPH_PAGE_SIZE,
  }
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
      [
        RevisionReads.ignoreWorkingCopy,
        'evolog',
        '--no-graph',
        '--revisions',
        revisions.map(revision => revision.commitId).join('|'),
        '--limit',
        '100',
        '--template',
        EVOLUTION_TEMPLATE,
      ],
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
      truncated: result.truncated || rows.length >= 100,
    }
  } catch {
    if (signal?.aborted === true) throw new Error('Jujutsu request was cancelled.')
    return { commitIds: new Set(), truncated: true }
  }
}

const readRemotes = async (
  ctx: Context,
  repo: RegisteredRepo,
  signal: AbortSignal | undefined,
): Promise<{ readonly names: string[]; readonly configFingerprint: string }> => {
  try {
    const result = await runAt(ctx, repo.root, repo.identity, [RevisionReads.ignoreWorkingCopy, 'git', 'remote', 'list'], signal, { outputLimit: 32_000 })
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
  // `status` is the only working-copy snapshot; every later read ignores the working copy so it sees that same `@`.
  const status = await runAt(ctx, repo.root, repo.identity, ['status'], signal, { outputLimit: 78_000 })
  const [revisionPage, changedPaths, remotes, lastPush] = await Promise.all([
    readRevisions(ctx, repo, limit, signal),
    RevisionReads.paths(repoRun(ctx, repo, signal), '@'),
    readRemotes(ctx, repo, signal),
    readLastPush(ctx, repo, signal),
  ])
  const evolution = await readEvolvedCommitIds(ctx, repo, revisionPage.revisions, signal)
  const graphRevisions = revisionPage.revisions.map(revision => ({ ...revision, evolved: evolution.commitIds.has(revision.commitId) }))
  await assertRepoIdentity(repo)
  const state: JujutsuState = {
    root: repo.root,
    revisions: graphRevisions,
    graphHasMore: revisionPage.hasMore,
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
      assertListedPaths(action.paths, selectedPaths)
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
      if (action.paths !== undefined) assertListedPaths(action.paths, selectedPaths)
      return {
        title: action.paths === undefined ? 'Squash changes' : 'Move files',
        summary:
          (action.paths === undefined ? 'Move ' + source.shortestChangeId : 'Move ' + action.paths.length + ' file(s) from ' + source.shortestChangeId) +
          ' into ' +
          destination.shortestChangeId,
        detail:
          (action.paths === undefined ? '' : 'Files:\n' + action.paths.join('\n') + '\n\n') +
          'Source: ' +
          firstLine(source.description) +
          '\nDestination: ' +
          firstLine(destination.description) +
          '\n\nResulting description:\n' +
          (action.message ?? (destination.description || '(empty)') + '\n(destination description kept)'),
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
    case 'bookmark-set': {
      const destination = findRevision(revisions, action.destinationId)
      const current = revisions.find(revision => revision.localBookmarks.includes(action.bookmark))
      return {
        title: 'Set bookmark',
        summary: 'Set ' + action.bookmark + ' at ' + destination.shortestChangeId,
        detail:
          (current === undefined
            ? 'Create bookmark at ' + destination.shortestChangeId
            : 'Current target: ' + current.shortestChangeId + '\nNew target: ' + destination.shortestChangeId) +
          '\n\nThis creates the bookmark if it is new, or updates it if it already exists. Backward and sideways movement is enabled.\n' +
          firstLine(destination.description),
      }
    }
    case 'bookmark-delete': {
      const current = revisions.find(revision => revision.localBookmarks.includes(action.bookmark))
      if (current === undefined) throw new Error('Bookmark is no longer present. Refresh and try again.')
      return {
        title: 'Delete bookmark',
        summary: 'Delete ' + action.bookmark + ' from ' + current.shortestChangeId,
        detail: 'The local bookmark is deleted; the next push propagates the deletion to tracked remotes.',
      }
    }
    case 'edit': {
      const revision = mutableRevision(revisions, action.commitId)
      if (revision.workingCopy) throw new Error('This revision is already the working copy.')
      return {
        title: 'Edit change',
        summary: 'Edit ' + revision.shortestChangeId + ' in the working copy',
        detail: firstLine(revision.description) + '\n\nThe working copy moves to this revision; later file edits amend it directly.',
      }
    }
    case 'new': {
      const revision = findRevision(revisions, action.commitId)
      return {
        title: 'New change',
        summary: 'Create an empty change on top of ' + revision.shortestChangeId,
        detail: 'Parent: ' + firstLine(revision.description) + '\n\nThe working copy moves to the new change.',
      }
    }
    case 'commit': {
      const revision = mutableRevision(revisions, action.commitId)
      if (!revision.workingCopy) throw new Error('Only the working-copy revision can be committed.')
      return {
        title: 'Commit working copy',
        summary: 'Describe ' + revision.shortestChangeId + ' and start a new change',
        detail: 'Description:\n' + action.message,
      }
    }
    case 'duplicate': {
      const revision = findRevision(revisions, action.commitId)
      return { title: 'Duplicate change', summary: 'Duplicate ' + revision.shortestChangeId, detail: firstLine(revision.description) }
    }
    case 'abandon': {
      const targets = action.commitIds.map(commitId => mutableRevision(revisions, commitId))
      return {
        title: targets.length === 1 ? 'Abandon change' : 'Abandon changes',
        summary: 'Abandon ' + targets.map(revision => revision.shortestChangeId).join(', '),
        detail:
          targets.map(revision => revision.shortestChangeId + '  ' + firstLine(revision.description)).join('\n') +
          '\n\nDescendants are rebased onto the abandoned changes\u2019 parents. Undo with jj undo.',
      }
    }
    case 'revert': {
      const revision = findRevision(revisions, action.commitId)
      const destination = findRevision(revisions, action.destinationId)
      return {
        title: 'Revert change',
        summary: 'Revert ' + revision.shortestChangeId + ' onto ' + destination.shortestChangeId,
        detail: 'A new change that undoes ' + firstLine(revision.description) + ' is created on top of ' + destination.shortestChangeId + '.',
      }
    }
    case 'restore': {
      const revision = mutableRevision(revisions, action.commitId)
      assertListedPaths(action.paths, selectedPaths)
      return {
        title: 'Discard file changes',
        summary: 'Restore ' + action.paths.length + ' file(s) in ' + revision.shortestChangeId + ' from its parent',
        detail: 'Files:\n' + action.paths.join('\n') + '\n\nThe changes these files carry in this revision are discarded.',
      }
    }
  }
}

const firstLine = (description: string): string => description.split('\n')[0] || '(no description)'

const mutableRevision = (revisions: readonly Revision[], commitId: string): Revision => {
  const revision = findRevision(revisions, commitId)
  if (revision.immutable) throw new Error('Jujutsu marks this revision immutable.')
  return revision
}

const assertListedPaths = (paths: readonly string[], listed: readonly string[]): void => {
  if (!paths.every(path => isSafeSplitPath(path) && listed.includes(path))) {
    throw new Error('Selected files must be listed in this revision and use safe literal paths.')
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
  const pathsRevision =
    preparedAction.kind === 'split' || preparedAction.kind === 'restore'
      ? preparedAction.commitId
      : preparedAction.kind === 'squash' && preparedAction.paths !== undefined
        ? preparedAction.sourceId
        : undefined
  const paths = pathsRevision === undefined ? current.state.changedPaths : await RevisionReads.paths(repoRun(ctx, repo, signal), pathsRevision)
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

/** Hands the user-written failure messages to the Client; others stay generic and are logged on the Host. */
const userFacing =
  <Args, Result>(handler: (args: Args) => Promise<Result>) =>
  async (args: Args): Promise<Result> => {
    try {
      return await handler(args)
    } catch (error) {
      throw RevisionReads.publicError(error)
    }
  }

const jujutsuHostApi = jujutsuApi.host({
  registerRepository: userFacing(async ({ input, ctx, signal }) => {
    const repo = await registerRepo(ctx, input.path, signal)
    return { repoId: repo.id, root: repo.root }
  }),
  load: async ({ input, ctx, signal }) => {
    try {
      const repo = await resolveRepo(ctx, input.repoId, signal)
      return (await snapshot(ctx, repo, input.limit, signal)).state
    } catch (error) {
      return RevisionReads.failure(error, 'Could not load this repository.')
    }
  },
  graphPage: async ({ input, ctx, signal }) => {
    try {
      const repo = await resolveRepo(ctx, input.repoId, signal)
      return await readGraphPage(ctx, repo, input.query, input.excludeCommitIds, signal)
    } catch (error) {
      return RevisionReads.failure(error, 'Could not read the next revision graph page.')
    }
  },
  graphNavigation: async ({ input, ctx, signal }) => {
    try {
      const repo = await resolveRepo(ctx, input.repoId, signal)
      return await readGraphNavigation(repoRun(ctx, repo, signal))
    } catch (error) {
      return RevisionReads.failure(error, 'Could not resolve graph landmarks.')
    }
  },
  revisionRelationship: async ({ input, ctx, signal }) => {
    try {
      const repo = await resolveRepo(ctx, input.repoId, signal)
      return await readRevisionRelationship({ run: repoRun(ctx, repo, signal), commitId: input.commitId, targetCommitId: input.targetCommitId })
    } catch (error) {
      return RevisionReads.failure(error, 'Could not compare revisions.')
    }
  },
  graphSlice: async ({ input, ctx, signal }) => {
    try {
      const repo = await resolveRepo(ctx, input.repoId, signal)
      return await readGraphSlice({ run: repoRun(ctx, repo, signal), commitId: input.commitId, mode: input.mode })
    } catch (error) {
      return RevisionReads.failure(error, 'Could not read revision history.')
    }
  },
  details: async ({ input, ctx, signal }) => {
    try {
      const repo = await resolveRepo(ctx, input.repoId, signal)
      return await RevisionReads.details(repoRun(ctx, repo, signal), input.commitId)
    } catch (error) {
      return RevisionReads.failure(error, 'Could not load revision details.')
    }
  },
  revisionFiles: userFacing(async ({ input, ctx, signal }) => {
    const repo = await resolveRepo(ctx, input.repoId, signal)
    return RevisionReads.fileStats(repoRun(ctx, repo, signal), [...new Set(input.commitIds)])
  }),
  workingDiff: userFacing(async ({ input, ctx, signal }) => {
    const repo = await resolveRepo(ctx, input.repoId, signal)
    const patch = await runAt(ctx, repo.root, repo.identity, ['diff', '--revisions', '@', '--git'], signal)
    return { patch: patch.truncated ? patch.stdout + '\n[diff truncated at the output limit]' : patch.stdout, truncated: patch.truncated }
  }),
  prepare: userFacing(async ({ input, ctx, signal }) => {
    const repo = await resolveRepo(ctx, input.repoId, signal)
    const current = await snapshot(ctx, repo, MAX_REVISIONS, signal)
    const prepared = await prepareMutation(ctx, repo, current, input.action, signal)
    const id = randomUUID()
    previews.put(id, prepared)
    return { id, kind: input.action.kind, title: prepared.title, summary: prepared.summary, detail: prepared.detail, expiresAt: prepared.expiresAt }
  }),
  confirm: userFacing(async ({ input, ctx, signal }) => {
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
  }),
})

/**
 * One writing convention for every Agent in this DSH: an explicit revision or bookmark reference is written
 * `jj:<name>`, which the client links to the panel and renders as the bare name.
 */
const chatReferenceSection = definePromptSection({
  name: 'dshfiles-jujutsu:chat-references',
  order: 900,
  text: [
    'In chat, write a Jujutsu revision, change or bookmark reference as `jj:<name>` inside inline code — for example',
    '`jj:main`, `jj:94526da8` or `jj:feature/topic`. DSH turns such a token into a link that opens the Jujutsu panel on',
    'that revision, and shows the reader the bare name.',
  ].join(' '),
})

export default defineHost({
  name: '@dshfiles/jujutsu',
  inject: ['subprocess', 'webServer'],
  apis: [jujutsuHostApi, composerContextHost((ctx, cwd, args, signal, options) => runAt(ctx, cwd, undefined, args, signal, options))],
  prompts: [chatReferenceSection],
  settings: [jujutsuSettings],
})
