import { randomUUID } from 'node:crypto'
import { Cache, Clock, Context, Duration, Effect, Layer, Option, Path } from 'effect'
import type { Mutation, Revision } from './api.js'
import { JujutsuMutationModel, JujutsuOutputModel, JujutsuPathModel, type PreparedMutation } from './core.js'
import { MutationRefused, PreviewExpired, WorkspaceChanged } from './errors.js'
import { JujutsuCommands } from './jujutsu-commands.js'
import { missingMutationRevisionIds, revisionIdsFor } from './mutation-revisions.js'
import { Repositories } from './repositories.js'
import { RepositoryIdentity, type RegisteredRepo } from './repository-identity.js'
import { RevisionReader, type MutationTarget, type Snapshot } from './revision-reader.js'
import { resolveWorkspaceDestination, sameWorkspaceParent } from './workspace-path.js'

const PREVIEW_TTL = Duration.minutes(5)
const MAX_PREVIEWS = 32
const MAX_REVISIONS = 500
const NETWORK_TIMEOUT = Duration.seconds(120)
const COMMAND_TIMEOUT = Duration.seconds(30)
const MAX_DETAIL = 7_800

interface Preview {
  readonly title: string
  readonly summary: string
  readonly detail: string
}

const refuse = (reason: MutationRefused['reason']) => Effect.fail(new MutationRefused({ reason }))

const firstLine = (description: string): string => description.split('\n')[0] || '(no description)'

const findRevision = Effect.fnUntraced(function* (revisions: readonly Revision[], commitId: string) {
  if (!JujutsuMutationModel.isCommitId(commitId)) return yield* refuse('invalid-revision')
  const row = revisions.find(revision => revision.commitId === commitId)
  if (row === undefined) return yield* refuse('revision-gone')
  return row
})

const mutableRevision = Effect.fnUntraced(function* (revisions: readonly Revision[], commitId: string) {
  const revision = yield* findRevision(revisions, commitId)
  if (revision.immutable) return yield* refuse('immutable')
  return revision
})

const listedPaths = (paths: readonly string[], listed: readonly string[]) =>
  paths.every(path => JujutsuPathModel.isSafeSplitPath(path) && listed.includes(path)) ? Effect.void : refuse('unlisted-paths')

const bookmarkTarget = (revisions: readonly Revision[], bookmark: string) =>
  Effect.fromOption(Option.fromUndefinedOr(revisions.find(revision => revision.localBookmarks.includes(bookmark)))).pipe(
    Effect.mapError(() => new MutationRefused({ reason: 'bookmark-gone' })),
  )

const mutationPreview = Effect.fnUntraced(function* (input: {
  readonly action: Mutation
  readonly revisions: readonly Revision[]
  readonly selectedPaths: readonly string[]
  readonly workspacePath: string | undefined
}) {
  const { action, revisions } = input
  switch (action.kind) {
    case 'describe': {
      const revision = yield* mutableRevision(revisions, action.commitId)
      return {
        title: 'Update description',
        summary: 'Change ' + revision.shortestChangeId + ' description',
        detail: 'Current:\n' + (revision.description || '(empty)') + '\n\nNew:\n' + action.message,
      }
    }
    case 'split': {
      const revision = yield* mutableRevision(revisions, action.commitId)
      yield* listedPaths(action.paths, input.selectedPaths)
      return {
        title: 'Split revision',
        summary: 'Split ' + revision.shortestChangeId + ' by selected files',
        detail: 'Files:\n' + action.paths.join('\n') + '\n\nNew revision description:\n' + action.message,
      }
    }
    case 'squash': {
      const source = yield* findRevision(revisions, action.sourceId)
      const destination = yield* findRevision(revisions, action.destinationId)
      if (source.immutable || destination.immutable) return yield* refuse('selection-immutable')
      if (action.paths !== undefined) yield* listedPaths(action.paths, input.selectedPaths)
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
      const source = yield* findRevision(revisions, action.sourceId)
      const destination = yield* findRevision(revisions, action.destinationId)
      if (source.immutable) return yield* refuse('source-immutable')
      if (source.commitId === destination.commitId) return yield* refuse('rebase-same')
      return {
        title: 'Rebase revision',
        summary: 'Rebase ' + source.shortestChangeId + ' onto ' + destination.shortestChangeId,
        detail: 'Jujutsu will rebase this revision and its descendants. Conflicts remain recorded in the repository for review.',
      }
    }
    case 'bookmark-move': {
      const destination = yield* findRevision(revisions, action.destinationId)
      const current = yield* bookmarkTarget(revisions, action.bookmark)
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
      const revision = yield* findRevision(revisions, action.commitId)
      if (input.workspacePath === undefined) return yield* new WorkspaceChanged({ reason: 'unvalidated' })
      return {
        title: 'Create isolated workspace',
        summary: 'Add ' + action.name + ' at ' + revision.shortestChangeId,
        detail:
          'Destination: ' +
          input.workspacePath +
          '\nBase: ' +
          revision.shortestChangeId +
          ' (' +
          revision.commitId +
          ')' +
          '\nThe current workspace and its working files remain in place.',
      }
    }
    case 'workspace-edit': {
      const destination = yield* findRevision(revisions, action.commitId)
      if (input.workspacePath === undefined) return yield* new WorkspaceChanged({ reason: 'unvalidated' })
      return {
        title: 'Move workspace',
        summary: 'Move workspace ' + action.name + ' to ' + destination.shortestChangeId,
        detail:
          'Workspace: ' +
          action.name +
          '\nFolder: ' +
          input.workspacePath +
          '\nDestination: ' +
          destination.shortestChangeId +
          ' (' +
          destination.commitId +
          ')\n\nOnly this workspace’s working copy moves; its uncommitted files are snapshotted by Jujutsu first.',
      }
    }
    case 'workspace-forget':
      return {
        title: 'Remove workspace',
        summary: 'Forget workspace ' + action.name,
        detail:
          'Folder: ' +
          (input.workspacePath ?? '(unknown)') +
          '\n\nUncommitted edits in that folder are recorded first. The workspace is unregistered from this repository; its folder, its files and every commit stay on disk. Delete the folder afterward with Clean up thread workspaces… if it is a thread workspace.',
      }
    case 'bookmark-set': {
      const destination = yield* findRevision(revisions, action.destinationId)
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
      const current = yield* bookmarkTarget(revisions, action.bookmark)
      return {
        title: 'Delete bookmark',
        summary: 'Delete ' + action.bookmark + ' from ' + current.shortestChangeId,
        detail: 'The local bookmark is deleted; the next push propagates the deletion to tracked remotes.',
      }
    }
    case 'edit': {
      const revision = yield* mutableRevision(revisions, action.commitId)
      if (revision.workingCopy) return yield* refuse('already-working-copy')
      return {
        title: 'Edit change',
        summary: 'Edit ' + revision.shortestChangeId + ' in the working copy',
        detail: firstLine(revision.description) + '\n\nThe working copy moves to this revision; later file edits amend it directly.',
      }
    }
    case 'new': {
      const revision = yield* findRevision(revisions, action.commitId)
      return {
        title: 'New change',
        summary: 'Create an empty change on top of ' + revision.shortestChangeId,
        detail: 'Parent: ' + firstLine(revision.description) + '\n\nThe working copy moves to the new change.',
      }
    }
    case 'commit': {
      const revision = yield* mutableRevision(revisions, action.commitId)
      if (!revision.workingCopy) return yield* refuse('not-working-copy')
      return {
        title: 'Commit working copy',
        summary: 'Describe ' + revision.shortestChangeId + ' and start a new change',
        detail: 'Description:\n' + action.message,
      }
    }
    case 'duplicate': {
      const revision = yield* findRevision(revisions, action.commitId)
      return { title: 'Duplicate change', summary: 'Duplicate ' + revision.shortestChangeId, detail: firstLine(revision.description) }
    }
    case 'abandon': {
      const targets = yield* Effect.forEach(action.commitIds, commitId => mutableRevision(revisions, commitId))
      return {
        title: targets.length === 1 ? 'Abandon change' : 'Abandon changes',
        summary: 'Abandon ' + targets.map(revision => revision.shortestChangeId).join(', '),
        detail:
          targets.map(revision => revision.shortestChangeId + '  ' + firstLine(revision.description)).join('\n') +
          '\n\nDescendants are rebased onto the abandoned changes\u2019 parents. Undo with jj undo.',
      }
    }
    case 'revert': {
      const revision = yield* findRevision(revisions, action.commitId)
      const destination = yield* findRevision(revisions, action.destinationId)
      return {
        title: 'Revert change',
        summary: 'Revert ' + revision.shortestChangeId + ' onto ' + destination.shortestChangeId,
        detail: 'A new change that undoes ' + firstLine(revision.description) + ' is created on top of ' + destination.shortestChangeId + '.',
      }
    }
    case 'restore': {
      const revision = yield* mutableRevision(revisions, action.commitId)
      yield* listedPaths(action.paths, input.selectedPaths)
      return {
        title: 'Discard file changes',
        summary: 'Restore ' + action.paths.length + ' file(s) in ' + revision.shortestChangeId + ' from its parent',
        detail: 'Files:\n' + action.paths.join('\n') + '\n\nThe changes these files carry in this revision are discarded.',
      }
    }
  }
})

/** Everything one action names, which is all its preview is bound to. */
const targetOf = (action: Mutation): MutationTarget => ({
  commitIds: revisionIdsFor(action),
  bookmark:
    action.kind === 'bookmark-move' || action.kind === 'bookmark-set' || action.kind === 'bookmark-delete' || action.kind === 'push'
      ? action.bookmark
      : undefined,
  remote: action.kind === 'fetch' || action.kind === 'push',
  workspace: action.kind === 'workspace-add' || action.kind === 'workspace-forget' || action.kind === 'workspace-edit' ? action.name : undefined,
})

const pathsRevisionOf = (action: Mutation): string | undefined => {
  if (action.kind === 'split' || action.kind === 'restore') return action.commitId
  if (action.kind === 'squash' && action.paths !== undefined) return action.sourceId
  return undefined
}

const make = Effect.gen(function* () {
  const path = yield* Path.Path
  const repositories = yield* Repositories
  const reader = yield* RevisionReader
  const identity = yield* RepositoryIdentity
  const commands = yield* JujutsuCommands

  const previews = yield* Cache.make({
    lookup: (previewId: string): Effect.Effect<PreparedMutation, PreviewExpired> => Effect.fail(new PreviewExpired({ previewId, reason: 'expired' })),
    capacity: MAX_PREVIEWS,
    timeToLive: PREVIEW_TTL,
  })

  const findWorkspace = Effect.fnUntraced(function* (repo: RegisteredRepo, name: string) {
    const workspaces = yield* repositories.workspaces(repo)
    return { workspaces, target: workspaces.find(workspace => workspace.name === name) }
  })

  const prepareMutation = Effect.fnUntraced(function* (repo: RegisteredRepo, current: Snapshot, action: Mutation) {
    const destination =
      action.kind === 'workspace-add'
        ? yield* resolveWorkspaceDestination({ repositoryPath: repo.root, selectedParentPath: action.parentPath, name: action.name })
        : undefined
    const preparedAction: Mutation = action.kind === 'workspace-add' && destination !== undefined ? { ...action, parentPath: destination.parentPath } : action
    const forgetOrEdit = action.kind === 'workspace-forget' || action.kind === 'workspace-edit' ? yield* findWorkspace(repo, action.name) : undefined
    if (forgetOrEdit !== undefined && forgetOrEdit.target === undefined) return yield* refuse('workspace-gone')
    if (action.kind === 'workspace-forget' && forgetOrEdit !== undefined && forgetOrEdit.workspaces.length <= 1) return yield* refuse('only-workspace')
    const workspaceRoot = forgetOrEdit?.target?.path
    const missingIds = missingMutationRevisionIds(preparedAction, current.state.revisions)
    if (!missingIds.every(JujutsuMutationModel.isCommitId)) return yield* refuse('invalid-revision')
    const revisions = yield* reader.withRevisions(repo, current.state.revisions, missingIds)
    yield* Effect.forEach(missingIds, commitId => findRevision(revisions, commitId))
    const pathsRevision = pathsRevisionOf(preparedAction)
    const selectedPaths = pathsRevision === undefined ? current.state.changedPaths : yield* reader.paths(repo, pathsRevision)
    const preview: Preview = yield* mutationPreview({ action: preparedAction, revisions, selectedPaths, workspacePath: destination?.path ?? workspaceRoot })
    const argv = yield* Effect.fromResult(JujutsuMutationModel.buildMutationArgv(preparedAction))
    if ((preparedAction.kind === 'fetch' || preparedAction.kind === 'push') && !current.state.remoteNames.includes(preparedAction.remote)) {
      return yield* refuse('remote-gone')
    }
    const pushBookmark = preparedAction.kind === 'push' ? preparedAction : undefined
    if (pushBookmark !== undefined && !current.state.revisions.some(row => row.localBookmarks.includes(pushBookmark.bookmark))) {
      return yield* refuse('bookmark-unlisted')
    }
    const dryRun =
      pushBookmark === undefined
        ? ''
        : yield* repositories
            .run(repo)(['git', 'push', '--dry-run', '--remote', pushBookmark.remote, '--bookmark', pushBookmark.bookmark], { timeout: NETWORK_TIMEOUT })
            .pipe(
              Effect.map(
                result =>
                  '\n\n' +
                  (JujutsuOutputModel.redactRemoteOutput(result.stdout, 7000) || 'JJ reported no dry-run output.') +
                  (result.truncated ? '\n[dry-run output truncated]' : ''),
              ),
              Effect.orElseSucceed(() => '\n\nRemote dry-run unavailable. No push has occurred; the real push requires confirmation.'),
            )
    const fullDetail = preview.detail + dryRun
    const detail = fullDetail.length > MAX_DETAIL ? fullDetail.slice(0, 7_760) + '\n[preview detail truncated]' : fullDetail
    const prepared: PreparedMutation = {
      root: repo.root,
      identity: current.identity,
      targets: yield* reader.targetState(repo, targetOf(preparedAction)),
      action: preparedAction,
      argv,
      title: preview.title,
      summary: preview.summary,
      detail,
      expiresAt: (yield* Clock.currentTimeMillis) + Duration.toMillis(PREVIEW_TTL),
      ...(destination !== undefined && { workspaceParentIdentity: destination.parentIdentity }),
      ...(destination === undefined && workspaceRoot !== undefined && { workspaceRoot }),
    }
    return prepared
  })

  /**
   * Take a preview once: it is gone after this read whether or not it still matches. It still applies only while
   * everything it names reads the same as at preview time; other revisions, workspaces and edits do not matter.
   */
  const take = Effect.fnUntraced(function* (previewId: string, repo: RegisteredRepo) {
    const prepared = yield* Cache.getOption(previews, previewId)
    yield* Cache.invalidate(previews, previewId)
    if (Option.isNone(prepared)) return yield* new PreviewExpired({ previewId, reason: 'expired' })
    const entry = prepared.value
    if (entry.root !== repo.root || entry.identity !== repo.identity) return yield* new PreviewExpired({ previewId, reason: 'repository' })
    // Snapshot this workspace's `@` first, so an edit made since the preview shows up as a rewritten target.
    yield* repositories.run(repo)(['status'], { outputLimit: 8_000 })
    const now = yield* reader.targetState(repo, targetOf(entry.action))
    if (now.remote !== entry.targets.remote) return yield* new PreviewExpired({ previewId, reason: 'remote-changed' })
    if (now.revisions !== entry.targets.revisions || now.bookmark !== entry.targets.bookmark) {
      return yield* new PreviewExpired({ previewId, reason: 'target-changed' })
    }
    if (now.workspace !== entry.targets.workspace) return yield* new WorkspaceChanged({ reason: 'moved' })
    return entry
  })

  /** Record a workspace's uncommitted edits before unregistering it; a folder that is already gone has none. */
  const snapshotWorkspace = (workspaceRoot: string | undefined) =>
    workspaceRoot === undefined ? Effect.void : commands.run({ cwd: workspaceRoot, args: ['status'], outputLimit: 8_000 }).pipe(Effect.ignore)

  const prepare = Effect.fn('jujutsu mutation prepare')(function* (input: { readonly repoId: string; readonly action: Mutation }) {
    const repo = yield* repositories.resolve(input.repoId)
    const current = yield* reader.snapshot(repo, MAX_REVISIONS)
    const prepared = yield* prepareMutation(repo, current, input.action)
    const id = randomUUID()
    yield* Cache.set(previews, id, prepared)
    return { id, kind: input.action.kind, title: prepared.title, summary: prepared.summary, detail: prepared.detail, expiresAt: prepared.expiresAt }
  })

  const confirm = Effect.fn('jujutsu mutation confirm')(function* (input: { readonly repoId: string; readonly previewId: string }) {
    const repo = yield* repositories.resolve(input.repoId)
    const prepared = yield* take(input.previewId, repo)
    yield* identity.verify(repo)
    const action = prepared.action
    const workspacePath =
      action.kind === 'workspace-add'
        ? yield* Effect.gen(function* () {
            const destination = yield* resolveWorkspaceDestination({ repositoryPath: repo.root, selectedParentPath: action.parentPath, name: action.name })
            if (
              prepared.workspaceParentIdentity === undefined ||
              !sameWorkspaceParent(prepared.workspaceParentIdentity, destination.parentIdentity) ||
              destination.parentPath !== action.parentPath ||
              destination.path !== path.join(action.parentPath, action.name)
            ) {
              return yield* new WorkspaceChanged({ reason: 'destination' })
            }
            return destination.path
          })
        : null
    if (action.kind === 'workspace-forget') yield* snapshotWorkspace(prepared.workspaceRoot)
    if (action.kind === 'workspace-edit') {
      const { target } = yield* findWorkspace(repo, action.name)
      if (target?.path !== prepared.workspaceRoot) return yield* new WorkspaceChanged({ reason: 'moved' })
    }
    const commandRoot = action.kind === 'workspace-edit' ? prepared.workspaceRoot : repo.root
    if (commandRoot === undefined) return yield* new WorkspaceChanged({ reason: 'unvalidated' })
    const result = yield* commands.run({
      cwd: commandRoot,
      expectedIdentity: action.kind === 'workspace-edit' ? undefined : repo.identity,
      args: prepared.argv,
      timeout: action.kind === 'fetch' || action.kind === 'push' ? NETWORK_TIMEOUT : COMMAND_TIMEOUT,
    })
    yield* identity.verify(repo)
    return {
      message: prepared.title + ' completed.',
      output: JujutsuOutputModel.redactRemoteOutput(result.stdout, 11_000) + (result.truncated ? '\n[command output truncated]' : ''),
      workspacePath,
    }
  })

  return { prepare, confirm }
})

/** Source Control actions: a one-use, five-minute preview bound to the repository state, then its confirmation. */
export class Mutations extends Context.Service<Mutations>()('@dshfiles/jujutsu/Mutations', { make }) {
  static readonly layer = Layer.effect(Mutations, Mutations.make)
}
