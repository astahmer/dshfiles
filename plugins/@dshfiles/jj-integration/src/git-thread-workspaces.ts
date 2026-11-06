import { Context, Effect, FileSystem, Layer, Option, Path, type PlatformError } from 'effect'
import { GitFailed, NotARepository, NotAThread, UnsafePath, WorkspaceFilesFailed, type ThreadWorkspaceError } from './errors.js'
import { Git, type GitCommandFailed, type GitRunFailed } from '@dshfiles/git-cli'
import { JjSettings } from './jj-settings.js'
import { RepoLocks } from './repo-locks.js'
import { ThreadIntegrationModel } from './thread-integration-state.js'
import { ThreadMetadata, type RebaseMetadataEntry } from './thread-metadata.js'
import type {
  DiscardOutcome,
  LandAtOptions,
  LandOutcome,
  ManagedThread,
  SecondaryDiscardResult,
  SecondaryWorkspaceStatus,
  ThreadDiscardResult,
  ThreadRevision,
  ThreadStatus,
  ThreadWorkspacesBackend,
  UntrackedEntry,
  VerifiedLandOptions,
  VerifiedLandOutcome,
} from './thread-workspace-types.js'
import type { ThreadLocation } from './thread-workspace-model.js'
import { LAND_ATTEMPTS, runVerifiedLand, type LandSettlement, type LandStepResult } from './verified-land-phases.js'

const THREAD_WORKSPACE_NAME = /^thread-[0-9a-f]{6}$/u
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u
const STATUS_READ_CONCURRENCY = 8
const MAX_BEHIND_REVISIONS = 1_000
/** Status, list and discard read at most this many unlanded commits: enough to show the work, bounded on any history. */
const MAX_UNLANDED_REVISIONS = 1_000
/** Session-undo snapshot refs kept per repository; older ones are deleted a batch at a time after each new snapshot. */
const MAX_SNAPSHOT_REFS = 200
const SNAPSHOT_PRUNE_BATCH = 20
const SNAPSHOT_REFS = 'refs/dsh/snapshots/'
/** Enough of `for-each-ref` to see far past the kept snapshots; a longer listing converges over later snapshots. */
const SNAPSHOT_LISTING_BYTES = 128 * 1024
const MAX_CONFLICT_FILES = 50
const GRAPH_REVISIONS = 20
const SNAPSHOT_AUTHOR = { GIT_AUTHOR_NAME: 'dsh', GIT_AUTHOR_EMAIL: 'dsh@localhost', GIT_COMMITTER_NAME: 'dsh', GIT_COMMITTER_EMAIL: 'dsh@localhost' }
/** git keeps uncommitted edits outside any commit; they surface as this one revision, undescribed, so landing asks for a commit. */
const WORKING_TREE_CHANGE_ID = 'working-tree'
const NULL_COMMIT_ID = '0'.repeat(40)
const workingTreeRevision: ThreadRevision = { changeId: WORKING_TREE_CHANGE_ID, commitId: NULL_COMMIT_ID, description: '', conflict: false }
/** Field and record separators no commit subject can hold. */
const FIELD = '\u001f'
const RECORD = '\u001e'
const REVISION_FORMAT = `--format=%H${FIELD}%s${RECORD}`

const threadBranch = (name: string): string => `dsh/${name}`
const isObjectId = (value: string): boolean => OBJECT_ID.test(value)

const parseRevisions = (stdout: string): readonly ThreadRevision[] =>
  stdout
    .split(RECORD)
    .map(record => record.replace(/^\n/u, ''))
    .flatMap(record => {
      const [commitId = '', description = ''] = record.split(FIELD)
      return isObjectId(commitId) ? [{ changeId: commitId, commitId, description: description.trim(), conflict: false }] : []
    })

interface WorktreeRecord {
  readonly path: string
  readonly head: string | undefined
  readonly branch: string | undefined
  readonly prunable: boolean
  readonly bare: boolean
}

const parseWorktrees = (stdout: string): readonly WorktreeRecord[] =>
  stdout
    .split('\n\n')
    .map(block => block.split('\n').filter(line => line.length > 0))
    .flatMap(lines => {
      const worktreePath = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length)
      if (worktreePath === undefined) return []
      return [
        {
          path: worktreePath,
          head: lines.find(line => line.startsWith('HEAD '))?.slice('HEAD '.length),
          branch: lines.find(line => line.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length),
          prunable: lines.some(line => line === 'prunable' || line.startsWith('prunable ')),
          bare: lines.includes('bare'),
        },
      ]
    })

const withRebaseMetadata = (status: ThreadStatus, entry: RebaseMetadataEntry | undefined): ThreadStatus => {
  if (entry === undefined) return status
  const statusWithTimestamp = { ...status, rebasedAt: entry.at, integrations: ThreadMetadata.integrationHistory(entry) }
  return entry.tipChangeId === undefined ? statusWithTimestamp : { ...statusWithTimestamp, rebasedTipChangeId: entry.tipChangeId }
}

const make = Effect.gen(function* () {
  const cli = yield* Git
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const locks = yield* RepoLocks
  const settings = yield* JjSettings
  const metadata = yield* ThreadMetadata

  /** The path with symlinks resolved, as git reports worktree paths; a missing tail keeps its resolved parent. */
  const canonical = (target: string): Effect.Effect<string> =>
    fileSystem.realPath(target).pipe(
      Effect.catch(() => {
        const parent = path.dirname(target)
        return parent === target ? Effect.succeed(path.resolve(target)) : Effect.map(canonical(parent), real => path.join(real, path.basename(target)))
      }),
    )
  // Compared with git's worktree paths, which git always reports with symlinks resolved.
  const threadsDirectory = (repoRoot: string) => Effect.flatMap(metadata.threadsDirectory(repoRoot), canonical)
  const bookmark = Effect.map(settings.get, current => current.bookmark)
  const exists = (target: string) => fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false))
  const filesFailed = (detail: string) => (cause: PlatformError.PlatformError) => new WorkspaceFilesFailed({ detail, cause })
  const gitFailed = (detail: string) => new GitFailed({ detail })

  /** The library's failures become this plugin's `git-failed` wire code, with the redacted detail as the message. */
  const asGitFailed = (cause: GitRunFailed | GitCommandFailed) => new GitFailed({ detail: cause.message, cause })
  const git = (args: readonly string[], cwd: string, env?: Readonly<Record<string, string>>) => cli.exec({ args, cwd, env }).pipe(Effect.mapError(asGitFailed))
  /** Keeps the first `maxStdoutBytes` of a long listing instead of failing it as `output-truncated`. */
  const gitHead = (args: readonly string[], cwd: string, maxStdoutBytes?: number) =>
    cli.exec({ args, cwd, maxStdoutBytes, onStdoutLimit: 'truncate' }).pipe(Effect.mapError(asGitFailed))
  const run = (args: readonly string[], cwd: string, env?: Readonly<Record<string, string>>) => cli.run({ args, cwd, env }).pipe(Effect.mapError(asGitFailed))
  const lines = (stdout: string): readonly string[] => stdout.split('\n').filter(line => line.length > 0)

  /**
   * Commits in `range`, newest first. Landing reads the whole range (it must see every commit it moves); a bounded read
   * stops at `maxCount` and keeps the head of an over-long listing, its cut-off last record dropped by the parser.
   */
  const revisions = (range: string, cwd: string, maxCount?: number) =>
    maxCount === undefined
      ? Effect.map(git(['log', REVISION_FORMAT, range, '--'], cwd), parseRevisions)
      : Effect.map(gitHead(['log', `--max-count=${String(maxCount)}`, REVISION_FORMAT, range, '--'], cwd), parseRevisions)

  const headOf = Effect.fnUntraced(function* (cwd: string) {
    const head = (yield* git(['rev-parse', '--verify', 'HEAD^{commit}'], cwd)).trim()
    if (!isObjectId(head))
      return yield* gitFailed(
        `Could not resolve the checked-out commit in ${cwd}. Run \`git status\` there; a branch without a first commit needs one before DSH can use it.`,
      )
    return head
  })

  /**
   * Any porcelain line means dirty, so only its head is kept: a tree with thousands of edits reads as cheaply. A line
   * can start with a space (` M file`), so the head is long enough to hold the status letters and a path.
   */
  const isDirty = (cwd: string) => Effect.map(gitHead(['status', '--porcelain=v1', '--untracked-files=normal'], cwd, 64), output => output.trim().length > 0)

  /** The ref the target bookmark names: the local branch, else `origin/<name>`, else the name as written. */
  const targetRef = Effect.fnUntraced(function* (cwd: string, name?: string) {
    const target = name ?? (yield* bookmark)
    if (isObjectId(target)) return target
    const recovery = 'Set the bookmark in Settings › Workspaces to an existing branch, or fetch it, then retry.'
    if (target.length === 0 || target.startsWith('-') || (yield* run(['check-ref-format', '--branch', target], cwd)).exitCode !== 0)
      return yield* gitFailed(`"${target}" is not a valid branch name. ${recovery}`)
    const local = yield* run(['rev-parse', '--verify', '--quiet', `refs/heads/${target}^{commit}`], cwd)
    if (local.exitCode === 0) return target
    const remote = yield* run(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${target}^{commit}`], cwd)
    if (remote.exitCode === 0) return `origin/${target}`
    return yield* gitFailed(`No branch "${target}" exists here or on origin. ${recovery}`)
  })

  const commitOf = Effect.fnUntraced(function* (cwd: string, ref: string) {
    const commit = (yield* git(['rev-parse', '--verify', `${ref}^{commit}`], cwd)).trim()
    if (!isObjectId(commit))
      return yield* gitFailed(
        `Could not resolve ${ref} to a commit in ${cwd}. Check that the branch exists (\`git branch --list\`), fetch it, or set the bookmark in Settings › Workspaces, then retry.`,
      )
    return commit
  })

  const worktrees = (repoRoot: string) =>
    Effect.map(git(['worktree', 'list', '--porcelain'], repoRoot), stdout =>
      parseWorktrees(stdout).map(record => ({ ...record, path: path.resolve(record.path) })),
    )

  const locate = Effect.fn('git thread workspaces locate')(function* (target: string) {
    const notARepository = new NotARepository({
      detail: `${target} is not inside a git repository. Open a folder inside a git or jj checkout, or run git init there.`,
    })
    if (!(yield* exists(target))) return yield* notARepository
    // --path-format=absolute: git otherwise prints the common dir relative to the cwd, not to the toplevel.
    const output = yield* run(['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'], target)
    const [toplevel, commonDir] = lines(output.stdout)
    if (output.exitCode !== 0 || toplevel === undefined || commonDir === undefined) return yield* notARepository
    const workspaceRoot = path.resolve(toplevel)
    const common = path.resolve(commonDir)
    // A bare repository has no main worktree to own thread workspaces.
    if (path.basename(common) !== '.git') return yield* notARepository
    const repoRoot = path.dirname(common)
    const isThread = workspaceRoot !== repoRoot && path.dirname(workspaceRoot) === (yield* threadsDirectory(repoRoot))
    return { repoRoot, workspaceRoot, threadName: isThread ? path.basename(workspaceRoot) : undefined, vcs: 'git' } satisfies ThreadLocation
  })

  const requireThread = Effect.fnUntraced(function* (target: string) {
    const location = yield* locate(target)
    if (location.threadName === undefined || !THREAD_WORKSPACE_NAME.test(location.threadName))
      return yield* new NotAThread({ detail: `${target} is not a managed thread workspace.` })
    return { ...location, threadName: location.threadName } satisfies ManagedThread
  })

  /** Commits of the thread the target lacks, newest first, after the uncommitted edits when there are any. */
  const unlandedIn = Effect.fnUntraced(function* (workspacePath: string, target: string) {
    const [committed, dirty] = yield* Effect.all([revisions(`${target}..HEAD`, workspacePath, MAX_UNLANDED_REVISIONS), isDirty(workspacePath)], {
      concurrency: 'unbounded',
    })
    return dirty ? [workingTreeRevision, ...committed] : committed
  })

  const branchExists = (repoRoot: string, name: string) =>
    Effect.map(run(['rev-parse', '--verify', '--quiet', `refs/heads/${threadBranch(name)}`], repoRoot), output => output.exitCode === 0)

  const statusOf = Effect.fnUntraced(function* (input: {
    readonly repoRoot: string
    readonly name: string
    readonly workspacePath: string
    readonly target: string
    readonly entry: RebaseMetadataEntry | undefined
  }) {
    const present = yield* exists(path.join(input.workspacePath, '.git'))
    const hasBranch = yield* branchExists(input.repoRoot, input.name)
    const tip = present ? 'HEAD' : threadBranch(input.name)
    const cwd = present ? input.workspacePath : input.repoRoot
    const [unlanded, behind] =
      present || hasBranch
        ? yield* Effect.all(
            [
              present ? unlandedIn(input.workspacePath, input.target) : revisions(`${input.target}..${tip}`, cwd, MAX_UNLANDED_REVISIONS),
              revisions(`${tip}..${input.target}`, cwd, MAX_BEHIND_REVISIONS + 1),
            ],
            { concurrency: 'unbounded' },
          )
        : [[], []]
    return withRebaseMetadata(
      {
        name: input.name,
        path: input.workspacePath,
        repoRoot: input.repoRoot,
        missing: !present,
        unlanded,
        behind: behind.length > 0,
        behindCount: Math.min(behind.length, MAX_BEHIND_REVISIONS),
      },
      input.entry,
    )
  })

  const threadWorktrees = Effect.fnUntraced(function* (repoRoot: string) {
    const directory = yield* threadsDirectory(repoRoot)
    return (yield* worktrees(repoRoot)).filter(record => path.dirname(record.path) === directory && THREAD_WORKSPACE_NAME.test(path.basename(record.path)))
  })

  const list = Effect.fn('git thread workspaces list')(function* (repoRoot: string) {
    const [records, entries, target] = yield* Effect.all([threadWorktrees(repoRoot), metadata.read(repoRoot), targetRef(repoRoot)], {
      concurrency: 'unbounded',
    })
    // One unreadable thread (a corrupt index, a lock, a timeout) must not hide every other thread of the repository. It
    // is left out of this list, never shown as clean, so cleanup cannot offer it; its own status read keeps the error.
    const statuses = yield* Effect.forEach(
      records,
      record => {
        const name = path.basename(record.path)
        return statusOf({ repoRoot, name, workspacePath: record.path, target, entry: entries[name] }).pipe(
          Effect.catch(error =>
            Effect.as(
              Effect.logWarning(`Skipped thread ${name} in ${repoRoot}: ${error.message} Run \`git status\` in ${record.path} to see and fix the error.`),
              undefined,
            ),
          ),
        )
      },
      { concurrency: STATUS_READ_CONCURRENCY },
    )
    return statuses.filter((entry): entry is ThreadStatus => entry !== undefined)
  })

  const status = Effect.fn('git thread workspaces status')(function* (repoRoot: string, name: string) {
    const workspacePath = path.join(yield* threadsDirectory(repoRoot), name)
    const [entries, target] = yield* Effect.all([metadata.read(repoRoot), targetRef(repoRoot)], { concurrency: 'unbounded' })
    return yield* statusOf({ repoRoot, name, workspacePath, target, entry: entries[name] })
  })

  const reviewHistory = Effect.fn('git thread workspaces review history')(function* (input: { readonly repoRoot: string; readonly name: string }) {
    if (!THREAD_WORKSPACE_NAME.test(input.name) || !path.isAbsolute(input.repoRoot))
      return yield* new NotAThread({ detail: 'The path is not a managed thread workspace location.' })
    const repoRoot = path.resolve(input.repoRoot)
    const located = yield* locate(repoRoot).pipe(Effect.option)
    if (Option.isNone(located) || located.value.repoRoot !== repoRoot)
      return yield* new NotARepository({ detail: 'The owning project is no longer a git repository.' })
    const entries = yield* metadata.read(repoRoot)
    return { repoRoot, name: input.name, integrations: [...ThreadMetadata.integrationHistory(entries[input.name])] }
  })

  /** Neither a folder, a worktree nor a thread branch may already carry the name. */
  const isFreeThreadName = Effect.fnUntraced(function* (repoRoot: string, name: string) {
    if (yield* exists(path.join(yield* threadsDirectory(repoRoot), name))) return false
    return !(yield* branchExists(repoRoot, name))
  })

  const freeThreadName = (repoRoot: string, requestedName: string | undefined): Effect.Effect<string, GitFailed> =>
    Effect.gen(function* () {
      if (requestedName !== undefined && THREAD_WORKSPACE_NAME.test(requestedName) && (yield* isFreeThreadName(repoRoot, requestedName))) return requestedName
      const name = `thread-${yield* ThreadMetadata.randomHex(3)}`
      return (yield* isFreeThreadName(repoRoot, name)) ? name : yield* freeThreadName(repoRoot, undefined)
    })

  /** `git worktree add`, its failure carrying what to run when a stale registration or a lock blocks the path. */
  const addWorktree = (repoRoot: string, workspacePath: string, args: readonly string[]) =>
    cli.exec({ args: ['worktree', 'add', ...args], cwd: repoRoot }).pipe(
      Effect.mapError(
        cause =>
          new GitFailed({
            detail: `Could not create the thread worktree ${workspacePath}: ${cause.message} If a deleted worktree still holds the path or branch, run \`git worktree prune\` in ${repoRoot} (and \`git worktree list\` to check), then retry.`,
            cause,
          }),
      ),
    )

  const provision = Effect.fn('git thread workspaces provision')(function* (repoRoot: string, base?: string, requestedName?: string) {
    return yield* locks.withRepo(repoRoot)(
      Effect.gen(function* () {
        const start = yield* targetRef(repoRoot, base)
        const directory = yield* threadsDirectory(repoRoot)
        const name = yield* freeThreadName(repoRoot, requestedName)
        const workspacePath = path.join(directory, name)
        yield* fileSystem.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(filesFailed(`Could not create ${directory}.`)))
        yield* addWorktree(repoRoot, workspacePath, ['--no-track', '-b', threadBranch(name), workspacePath, start])
        return { name, path: workspacePath }
      }),
    )
  })

  const branchPoint = Effect.fn('git thread workspaces branch point')(function* (workspaceRoot: string) {
    return yield* headOf(workspaceRoot)
  })

  const restore = Effect.fn('git thread workspaces restore')(function* (repoRoot: string, workspacePath: string) {
    return yield* locks.withRepo(repoRoot)(
      Effect.gen(function* () {
        if (yield* exists(path.join(workspacePath, '.git'))) return
        const name = path.basename(workspacePath)
        if (!THREAD_WORKSPACE_NAME.test(name) || path.dirname(workspacePath) !== (yield* threadsDirectory(repoRoot)))
          return yield* new NotAThread({ detail: `${workspacePath} is not a managed thread workspace.` })
        yield* fileSystem
          .makeDirectory(path.dirname(workspacePath), { recursive: true })
          .pipe(Effect.mapError(filesFailed(`Could not create ${path.dirname(workspacePath)}.`)))
        yield* git(['worktree', 'prune'], repoRoot)
        // The thread branch keeps its commits after the folder is gone; only a never-committed thread starts over.
        if (yield* branchExists(repoRoot, name)) yield* addWorktree(repoRoot, workspacePath, [workspacePath, threadBranch(name)])
        else yield* addWorktree(repoRoot, workspacePath, ['--no-track', '-b', threadBranch(name), workspacePath, yield* targetRef(repoRoot)])
      }),
    )
  })

  /**
   * A rebase the user started in the thread (stopped on a conflict or an `edit`) is theirs: landing would fail on it,
   * and its cleanup abort would throw their resolution away. Integration refuses until it is finished or dropped.
   */
  const refuseRebaseInProgress = Effect.fnUntraced(function* (cwd: string) {
    const state = lines(yield* git(['rev-parse', '--path-format=absolute', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply'], cwd))
    const inProgress = yield* Effect.forEach(state, exists, { concurrency: 'unbounded' })
    if (inProgress.some(Boolean))
      return yield* gitFailed(
        `A git rebase is already in progress in ${cwd}. Finish it with \`git rebase --continue\` or drop it with \`git rebase --abort\` there, then integrate again.`,
      )
  })

  /** Rebase the thread branch onto `base`; a conflict is aborted, so the worktree is left exactly as it was. */
  const rebaseOnto = Effect.fnUntraced(function* (cwd: string, base: string) {
    yield* refuseRebaseInProgress(cwd)
    const rebased = yield* run(['rebase', '--no-autostash', '--no-update-refs', base], cwd)
    if (rebased.exitCode === 0) return { status: 'rebased' as const }
    const files = lines(yield* git(['diff', '--name-only', '--diff-filter=U'], cwd).pipe(Effect.orElseSucceed(() => ''))).slice(0, MAX_CONFLICT_FILES)
    const aborted = yield* run(['rebase', '--abort'], cwd)
    if (aborted.exitCode !== 0)
      return yield* gitFailed(
        `git rebase stopped in ${cwd} and \`git rebase --abort\` failed: ${aborted.stderr.trim().slice(0, 300)} Run \`git status\` there, then finish or abort the rebase by hand before integrating again.`,
      )
    if (files.length === 0)
      return yield* gitFailed(
        `git rebase failed: ${rebased.stderr.trim().slice(0, 400)} Run \`git rebase ${base}\` in ${cwd} to see the full error, then integrate again.`,
      )
    return { status: 'conflicted' as const, files }
  })

  /**
   * Advance the bookmark branch from `from` to `to`, only forward. Where the branch is checked out, its worktree
   * fast-forwards so its files follow; elsewhere the ref moves with compare-and-swap against `from`.
   */
  const advanceBookmark = Effect.fnUntraced(function* (input: {
    readonly repoRoot: string
    readonly name: string
    readonly from: string
    readonly to: string
  }) {
    const holder = (yield* worktrees(input.repoRoot)).find(record => record.branch === input.name && !record.prunable)
    if (holder !== undefined) {
      if (holder.head !== input.from) return false
      const merged = yield* run(['merge', '--ff-only', '--no-edit', input.to], holder.path)
      if (merged.exitCode !== 0)
        return yield* gitFailed(
          `Could not fast-forward ${input.name} in ${holder.path}: ${merged.stderr.trim().slice(0, 300)} Commit or stash the edits there, then integrate again.`,
        )
      return true
    }
    const local = yield* run(['rev-parse', '--verify', '--quiet', `refs/heads/${input.name}`], input.repoRoot)
    const expected = local.exitCode === 0 ? input.from : NULL_COMMIT_ID
    const moved = yield* run(['update-ref', `refs/heads/${input.name}`, input.to, expected], input.repoRoot)
    return moved.exitCode === 0
  })

  const landAt = <E = never>(thread: ManagedThread, input: LandAtOptions<E> = {}): Effect.Effect<LandOutcome, GitFailed | E> => {
    const progress = (phase: 'queued' | 'validating' | 'rebasing') => input.onProgress?.(phase) ?? Effect.void
    return Effect.gen(function* () {
      yield* progress('queued')
      return yield* locks.withRepo(thread.repoRoot)(
        Effect.gen(function* () {
          yield* progress('validating')
          if (input.validate !== undefined) yield* input.validate
          const cwd = thread.workspaceRoot
          const name = input.bookmark ?? (yield* bookmark)
          for (let attempt = 1; ; attempt++) {
            yield* progress('rebasing')
            // Before the dirty check: a rebase stopped on a conflict leaves edits, and committing them is not the fix.
            yield* refuseRebaseInProgress(cwd)
            if (yield* isDirty(cwd)) return { status: 'needs-description', revisions: [workingTreeRevision] } satisfies LandOutcome
            const base = yield* commitOf(cwd, yield* targetRef(cwd, name))
            const work = yield* revisions(`${base}..HEAD`, cwd)
            if (work.length === 0) return { status: 'nothing-to-land' } satisfies LandOutcome
            const undescribed = work.filter(revision => ThreadIntegrationModel.isPlaceholderRevisionDescription(revision.description))
            if (undescribed.length > 0) return { status: 'needs-description', revisions: undescribed } satisfies LandOutcome
            const rebase = yield* rebaseOnto(cwd, base)
            if (rebase.status === 'conflicted') return { status: 'conflicted', revisions: work, files: rebase.files } satisfies LandOutcome
            const rebased = yield* revisions(`${base}..HEAD`, cwd)
            const head = rebased[0]
            // Every commit was already on the bookmark: git dropped them as it rebased.
            if (head === undefined) return { status: 'nothing-to-land' } satisfies LandOutcome
            if (yield* advanceBookmark({ repoRoot: thread.repoRoot, name, from: base, to: head.commitId })) {
              yield* metadata
                .record(thread.repoRoot, thread.threadName, { tipChangeId: head.commitId, baseChangeId: base, sessionId: input.sessionId })
                .pipe(Effect.ignore)
              return { status: 'landed', revisions: rebased, head } satisfies LandOutcome
            }
            if (attempt >= LAND_ATTEMPTS) return yield* gitFailed(`Could not move ${name}: another writer kept moving it. Retry the integration.`)
          }
        }),
      )
    }).pipe(Effect.withSpan('git thread workspaces land'))
  }

  const land = <E = never>(target: string, input: LandAtOptions<E> = {}) => Effect.flatMap(requireThread(target), thread => landAt(thread, input))

  const stale = (message: string): VerifiedLandOutcome => ({ status: 'verification-stale', message })

  /** `git cherry`: commits of the thread whose patch the base already holds (`-`) and those it lacks (`+`). */
  const patchEquivalent = Effect.fnUntraced(function* (cwd: string, base: string) {
    const listed = lines(yield* git(['cherry', base, 'HEAD'], cwd))
    return new Set(listed.filter(line => line.startsWith('- ')).map(line => line.slice(2).trim()))
  })

  interface GitLandScan {
    readonly base: string
    readonly work: readonly ThreadRevision[]
  }
  interface GitLandRebase extends GitLandScan {
    readonly rebased: readonly ThreadRevision[]
    readonly head: ThreadRevision
  }

  const landVerified = Effect.fn('git thread workspaces land verified')(function* (input: VerifiedLandOptions) {
    const cancelled = input.cancelled ?? Effect.succeed(false)
    const cancelledOutcome: VerifiedLandOutcome = { status: 'verification-cancelled' }
    if (yield* cancelled) return cancelledOutcome
    const initialThread = yield* requireThread(input.path)
    return yield* locks.withRepo(initialThread.repoRoot)(
      Effect.gen(function* () {
        const thread = yield* requireThread(input.path)
        if (thread.repoRoot !== initialThread.repoRoot || thread.threadName !== initialThread.threadName)
          return { status: 'not-eligible' } satisfies VerifiedLandOutcome
        const authorized = input.authorize(thread)
        if (!(yield* authorized)) return { status: 'not-eligible' } satisfies VerifiedLandOutcome
        const cwd = thread.workspaceRoot
        const name = input.bookmark ?? (yield* bookmark)
        if ((yield* headOf(cwd)) !== input.expectedSourceRevision)
          return stale('The thread changed after its completion checks passed. Stop for Project Checks again; automatic integration did not rebase it.')

        const stop = (outcome: VerifiedLandOutcome): LandSettlement => ({ _tag: 'stop', outcome })
        const nextStep = <State>(state: State): LandStepResult<State> => ({ _tag: 'next', state })
        const retry = (exhausted: string): LandSettlement => ({ _tag: 'restart', exhausted })

        const scan = (_base: null, _attempt: number): Effect.Effect<LandStepResult<GitLandScan>, ThreadWorkspaceError> =>
          Effect.gen(function* () {
            if (!(yield* authorized)) return stop({ status: 'not-eligible' })
            yield* refuseRebaseInProgress(cwd)
            if (yield* isDirty(cwd)) return stop({ status: 'needs-description', revisions: [workingTreeRevision] })
            const base = yield* commitOf(cwd, yield* targetRef(cwd, name))
            const work = yield* revisions(`${base}..HEAD`, cwd)
            if (work.length === 0) return stop({ status: 'nothing-to-land' })
            const equivalent = yield* patchEquivalent(cwd, base)
            const represented = work.filter(revision => equivalent.has(revision.commitId))
            if (represented.length > 0)
              return stop(
                represented.length === work.length
                  ? { status: 'already-integrated', revisions: represented }
                  : { status: 'patch-equivalent-work', revisions: represented },
              )
            const undescribed = work.filter(revision => ThreadIntegrationModel.isPlaceholderRevisionDescription(revision.description))
            if (undescribed.length > 0) return stop({ status: 'needs-description', revisions: undescribed })
            return nextStep({ base, work })
          })

        const rebase = (scanned: GitLandScan, _attempt: number): Effect.Effect<LandStepResult<GitLandRebase>, ThreadWorkspaceError> =>
          Effect.gen(function* () {
            if (!(yield* authorized)) return stop({ status: 'not-eligible' })
            const rebasedState = yield* rebaseOnto(cwd, scanned.base)
            if (rebasedState.status === 'conflicted') return stop({ status: 'conflicted', revisions: scanned.work, files: rebasedState.files })
            const rebased = yield* revisions(`${scanned.base}..HEAD`, cwd)
            const head = rebased[0]
            if (head === undefined) return stop({ status: 'nothing-to-land' })
            if (yield* cancelled) return stop(cancelledOutcome)
            if (!(yield* authorized)) return stop({ status: 'not-eligible' })
            return nextStep({ base: scanned.base, work: scanned.work, rebased, head })
          })

        const verify = (rebasedState: GitLandRebase, attempt: number): Effect.Effect<LandStepResult<GitLandRebase>, ThreadWorkspaceError> =>
          Effect.gen(function* () {
            const verification = yield* input.verifyCandidate({ workingCopyCommitId: rebasedState.head.commitId, attempt })
            if (verification.status === 'cancelled' || (yield* cancelled)) return stop(cancelledOutcome)
            if (verification.status === 'stale') return stop(stale(verification.message))
            if (verification.status === 'failed') return stop({ status: 'verification-failed', message: verification.message })
            if ((yield* headOf(cwd)) !== rebasedState.head.commitId || (yield* isDirty(cwd)))
              return stop(stale('The thread changed while Project Checks ran. The bookmark was not advanced; review the current work.'))
            if (!(yield* authorized)) return stop({ status: 'not-eligible' })
            return nextStep(rebasedState)
          })

        const land = (verified: GitLandRebase, _attempt: number): Effect.Effect<LandSettlement, ThreadWorkspaceError> =>
          Effect.gen(function* () {
            if (!(yield* authorized)) return stop({ status: 'not-eligible' })
            const current = yield* commitOf(cwd, yield* targetRef(cwd, name))
            if (current === verified.base && (yield* advanceBookmark({ repoRoot: thread.repoRoot, name, from: verified.base, to: verified.head.commitId }))) {
              yield* metadata
                .record(thread.repoRoot, thread.threadName, { tipChangeId: verified.head.commitId, baseChangeId: verified.base, sessionId: input.sessionId })
                .pipe(Effect.ignore)
              return stop({ status: 'landed', revisions: verified.rebased, head: verified.head })
            }
            const movedForward = (yield* run(['merge-base', '--is-ancestor', verified.base, yield* targetRef(cwd, name)], cwd)).exitCode === 0
            if (!movedForward) return stop(stale('The target bookmark moved backwards or sideways while landing; review it before retrying.'))
            return retry('The bookmark changed before the checked revision could be landed; retry integration.')
          })

        return yield* runVerifiedLand({
          cancelled,
          cancelledOutcome,
          start: () => null,
          steps: { scan, rebase, verify, land },
        })
      }),
    )
  })

  const ensureSafeName = (name: string, verb: string) =>
    name.includes('/') || name.startsWith('.') ? Effect.fail(new UnsafePath({ detail: `Refusing to ${verb} ${name}.` })) : Effect.void

  const removeTree = (target: string) =>
    fileSystem.remove(target, { recursive: true, force: true }).pipe(Effect.mapError(filesFailed(`Could not remove ${target}.`)))

  const discardOne = Effect.fnUntraced(function* (input: {
    readonly repoRoot: string
    readonly name: string
    readonly force: boolean
    readonly target: string
  }) {
    yield* ensureSafeName(input.name, 'discard workspace')
    if (!THREAD_WORKSPACE_NAME.test(input.name)) return yield* new UnsafePath({ detail: `Refusing to discard ${input.name}: it is not a managed thread name.` })
    const workspaceRoot = path.join(yield* threadsDirectory(input.repoRoot), input.name)
    const present = yield* exists(path.join(workspaceRoot, '.git'))
    if (present && !(yield* worktrees(input.repoRoot)).some(record => record.path === workspaceRoot))
      return yield* new UnsafePath({ detail: `${workspaceRoot} is not a worktree of ${input.repoRoot}; remove it from the repository it belongs to.` })
    const hasBranch = yield* branchExists(input.repoRoot, input.name)
    const work = present
      ? yield* unlandedIn(workspaceRoot, input.target)
      : hasBranch
        ? yield* revisions(`${input.target}..${threadBranch(input.name)}`, input.repoRoot, MAX_UNLANDED_REVISIONS)
        : []
    if (work.length > 0 && !input.force) return { status: 'has-work', revisions: work } satisfies DiscardOutcome
    if (present) yield* git(['worktree', 'remove', '--force', workspaceRoot], input.repoRoot)
    yield* removeTree(workspaceRoot)
    yield* git(['worktree', 'prune'], input.repoRoot)
    if (hasBranch) yield* git(['branch', '-D', threadBranch(input.name)], input.repoRoot)
    return { status: 'discarded' } satisfies DiscardOutcome
  })

  const discard = Effect.fn('git thread workspaces discard')(function* (input: { readonly repoRoot: string; readonly name: string; readonly force: boolean }) {
    return yield* locks.withRepo(input.repoRoot)(Effect.flatMap(targetRef(input.repoRoot), target => discardOne({ ...input, target })))
  })

  const discardMany = Effect.fn('git thread workspaces discard many')(function* (input: {
    readonly repoRoot: string
    readonly names: readonly string[]
    readonly force: boolean
  }) {
    return yield* locks.withRepo(input.repoRoot)(
      Effect.gen(function* () {
        const target = yield* targetRef(input.repoRoot)
        // Each removal prunes the same worktree registry, so they run one at a time.
        const results = yield* Effect.forEach([...new Set(input.names)], name =>
          discardOne({ repoRoot: input.repoRoot, name, force: input.force, target }).pipe(
            Effect.map((outcome): ThreadDiscardResult =>
              outcome.status === 'has-work'
                ? { name, status: 'has-work', revisions: outcome.revisions, error: null }
                : { name, status: 'discarded', revisions: [], error: null },
            ),
            Effect.catch(error => Effect.succeed<ThreadDiscardResult>({ name, status: 'error', revisions: [], error: error.message })),
          ),
        )
        return { results }
      }),
    )
  })

  const secondaryWorkspaces = Effect.fn('git thread workspaces list secondary')(function* (repoRoot: string) {
    const directory = yield* threadsDirectory(repoRoot)
    const [main, ...others] = yield* worktrees(repoRoot)
    if (main === undefined) return []
    const target = yield* targetRef(repoRoot)
    return yield* Effect.forEach(
      others.filter(record => path.dirname(record.path) !== directory && path.resolve(record.path) !== path.resolve(main.path)),
      record =>
        Effect.gen(function* () {
          const name = path.basename(record.path)
          if (record.prunable || !(yield* exists(record.path))) {
            const unlanded = record.head === undefined ? [] : yield* revisions(`${target}..${record.head}`, repoRoot).pipe(Effect.orElseSucceed(() => []))
            return { name, path: record.path, repoRoot, missing: true, unlanded, workingCopyState: 'missing' } satisfies SecondaryWorkspaceStatus
          }
          const [unlanded, dirty] = yield* Effect.all(
            [revisions(`${target}..HEAD`, record.path).pipe(Effect.option), isDirty(record.path).pipe(Effect.option)],
            { concurrency: 'unbounded' },
          )
          const workingCopyState = Option.isNone(unlanded) || Option.isNone(dirty) ? 'unknown' : dirty.value ? 'dirty' : 'clean'
          return {
            name,
            path: record.path,
            repoRoot,
            missing: false,
            unlanded: Option.getOrElse(unlanded, () => []),
            workingCopyState,
          } satisfies SecondaryWorkspaceStatus
        }),
      { concurrency: STATUS_READ_CONCURRENCY },
    )
  })

  const discardSecondaryMany = Effect.fn('git thread workspaces discard secondary')(function* (input: {
    readonly repoRoot: string
    readonly workspaces: readonly { readonly name: string; readonly path: string; readonly missing: boolean }[]
  }) {
    return yield* locks.withRepo(input.repoRoot)(
      Effect.gen(function* () {
        const seen = new Set<string>()
        const unique = input.workspaces.filter(workspace => !seen.has(workspace.path) && (seen.add(workspace.path), true))
        // Each removal rereads the worktrees the previous one may have changed.
        const results = yield* Effect.forEach(unique, expected =>
          Effect.gen(function* () {
            const current = (yield* secondaryWorkspaces(input.repoRoot)).find(workspace => workspace.path === expected.path)
            if (current === undefined || current.name !== expected.name || current.missing !== expected.missing)
              return { ...expected, status: 'error', message: 'The git worktree changed after preview.' } satisfies SecondaryDiscardResult
            if ((!current.missing && current.workingCopyState !== 'clean') || current.unlanded.length > 0) {
              const message =
                current.workingCopyState === 'unknown'
                  ? 'The working-copy state could not be verified.'
                  : current.workingCopyState === 'dirty'
                    ? 'The worktree has uncommitted changes.'
                    : 'The worktree has unlanded commits.'
              return { name: expected.name, path: expected.path, status: 'has-work', message } satisfies SecondaryDiscardResult
            }
            // `worktree remove` refuses a dirty tree on its own, so a change made since the read above is kept.
            if (current.missing) yield* git(['worktree', 'prune'], input.repoRoot)
            else yield* git(['worktree', 'remove', current.path], input.repoRoot)
            return { name: expected.name, path: expected.path, status: 'discarded', message: null } satisfies SecondaryDiscardResult
          }).pipe(
            Effect.catch(error =>
              Effect.succeed<SecondaryDiscardResult>({ name: expected.name, path: expected.path, status: 'error', message: error.message }),
            ),
          ),
        )
        return { results }
      }),
    )
  })

  const workingCopyChangedAt = Effect.fn('git thread workspaces working copy times')(function* (repoRoot: string) {
    const present = (yield* threadWorktrees(repoRoot)).filter(record => !record.prunable)
    const modifiedAt = (target: string) =>
      fileSystem.stat(target).pipe(
        Effect.map(info => Option.match(info.mtime, { onNone: () => Number.NaN, onSome: date => date.getTime() })),
        Effect.orElseSucceed(() => Number.NaN),
      )
    // HEAD's commit time alone reads a fresh thread cut from an old bookmark as idle since that commit. The worktree's
    // index (written by checkout, add and status refreshes) and its folder (files added or removed) move with use.
    const changedAt = Effect.fnUntraced(function* (worktreePath: string) {
      const [seconds, indexPath] = yield* Effect.all(
        [
          git(['log', '-1', '--format=%ct', 'HEAD'], worktreePath).pipe(Effect.orElseSucceed(() => '')),
          git(['rev-parse', '--path-format=absolute', '--git-path', 'index'], worktreePath).pipe(Effect.orElseSucceed(() => '')),
        ],
        { concurrency: 'unbounded' },
      )
      const [index, folder] = yield* Effect.all(
        [indexPath.trim().length > 0 ? modifiedAt(indexPath.trim()) : Effect.succeed(Number.NaN), modifiedAt(worktreePath)],
        {
          concurrency: 'unbounded',
        },
      )
      const candidates = [Number.parseInt(seconds.trim(), 10) * 1000, index, folder].filter(Number.isFinite)
      return candidates.length === 0 ? Number.NaN : Math.max(...candidates)
    })
    const times = yield* Effect.forEach(
      present,
      record => Effect.map(changedAt(record.path), (at): readonly [string, number] => [path.basename(record.path), at]),
      { concurrency: STATUS_READ_CONCURRENCY },
    )
    return new Map(times.filter(([, at]) => Number.isFinite(at))) satisfies ReadonlyMap<string, number>
  })

  const ownedByWorktree = Effect.fnUntraced(function* (repoRoot: string) {
    const roots = new Set((yield* worktrees(repoRoot)).map(record => record.path))
    return (entry: string): Effect.Effect<boolean> => Effect.map(canonical(entry), real => roots.has(real))
  })

  const untrackedEntries = Effect.fn('git thread workspaces untracked')(function* (repoRoot: string) {
    const directory = yield* threadsDirectory(repoRoot)
    const [isOwned, entries] = yield* Effect.all(
      [ownedByWorktree(repoRoot), fileSystem.readDirectory(directory).pipe(Effect.orElseSucceed((): readonly string[] => []))],
      { concurrency: 'unbounded' },
    )
    const found = yield* Effect.forEach(
      entries.filter(name => !name.startsWith('.')),
      name =>
        Effect.gen(function* () {
          const entry = path.join(directory, name)
          if (yield* isOwned(entry)) return undefined
          const modifiedAt = Option.flatMap(yield* fileSystem.lstat(entry).pipe(Effect.option), info => info.mtime)
          return Option.isSome(modifiedAt) ? ({ name, path: entry, modifiedAt: Math.round(modifiedAt.value.getTime()) } satisfies UntrackedEntry) : undefined
        }),
      { concurrency: STATUS_READ_CONCURRENCY },
    )
    return found.filter(entry => entry !== undefined)
  })

  const removeUntrackedEntry = Effect.fn('git thread workspaces remove untracked')(function* (input: { readonly repoRoot: string; readonly name: string }) {
    return yield* locks.withRepo(input.repoRoot)(
      Effect.gen(function* () {
        yield* ensureSafeName(input.name, 'remove')
        const entry = path.join(yield* threadsDirectory(input.repoRoot), input.name)
        if (yield* (yield* ownedByWorktree(input.repoRoot))(entry)) return yield* new UnsafePath({ detail: `${input.name} belongs to a git worktree now.` })
        // A checkout git no longer lists (another repository's, or one with a broken link) may still hold uncommitted work.
        if (yield* exists(path.join(entry, '.git')))
          return yield* new UnsafePath({
            detail: `${input.name} holds a git checkout; discard it from its own repository, or remove it by hand once its work is safe.`,
          })
        yield* removeTree(entry)
        yield* git(['worktree', 'prune'], input.repoRoot)
      }),
    )
  })

  const bookmarks = Effect.fn('git thread workspaces bookmarks')(function* (target: string) {
    const branchNames = (args: readonly string[]) =>
      Effect.map(git(['for-each-ref', ...args, '--format=%(refname:short)', 'refs/heads'], target), output =>
        lines(output).filter(name => !name.startsWith('dsh/')),
      )
    const [listed, nearest] = yield* Effect.all([branchNames([]), branchNames(['--merged', 'HEAD', '--sort=-committerdate'])], { concurrency: 'unbounded' })
    const preferred = yield* bookmark
    return { current: nearest.includes(preferred) ? preferred : (nearest[0] ?? null), names: [...new Set(listed)] }
  })

  const workingCopyCommitId = Effect.fn('git thread workspaces working copy')(function* (target: string) {
    return yield* headOf(target)
  })

  const scratchIndex = (prefix: string) =>
    fileSystem.makeTempDirectoryScoped({ prefix }).pipe(
      Effect.map(directory => ({ GIT_INDEX_FILE: path.join(directory, 'index') })),
      Effect.mapError(filesFailed('Could not create a scratch git index.')),
    )

  /**
   * Keeps the newest `MAX_SNAPSHOT_REFS` snapshot refs of the repository (refs are shared by all its worktrees) and
   * deletes at most `SNAPSHOT_PRUNE_BATCH` older ones per call, so a backlog drains over later snapshots without one
   * snapshot paying for it. Best effort: a failed prune never fails the snapshot that triggered it.
   */
  const pruneSnapshots = (cwd: string) =>
    Effect.gen(function* () {
      const listing = yield* gitHead(['for-each-ref', '--sort=-creatordate', '--format=%(refname)', SNAPSHOT_REFS], cwd, SNAPSHOT_LISTING_BYTES)
      // A truncated listing may end mid-name; only whole snapshot ref names are deleted.
      const refs = lines(listing).filter(ref => ref.startsWith(SNAPSHOT_REFS) && isObjectId(ref.slice(SNAPSHOT_REFS.length)))
      const expired = refs.slice(MAX_SNAPSHOT_REFS).slice(-SNAPSHOT_PRUNE_BATCH)
      yield* Effect.forEach(expired, ref => git(['update-ref', '-d', ref], cwd), { discard: true })
    }).pipe(Effect.ignore)

  /**
   * A commit of every tracked and untracked, non-ignored file under `refs/dsh/snapshots/`, built in a throwaway
   * index so neither the real index nor HEAD moves (the same snapshots `@dshfiles/git-worktrees` takes).
   */
  const snapshotOf = (workspaceRoot: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const index = yield* scratchIndex('dsh-git-snapshot-')
        yield* git(['add', '--all', '.'], workspaceRoot, index)
        const tree = (yield* git(['write-tree'], workspaceRoot, index)).trim()
        const commit = (yield* git(['commit-tree', tree, '-m', 'dsh file snapshot'], workspaceRoot, SNAPSHOT_AUTHOR)).trim()
        if (!isObjectId(commit)) return yield* gitFailed('git commit-tree returned no commit id.')
        yield* git(['update-ref', `${SNAPSHOT_REFS}${commit}`, commit], workspaceRoot)
        yield* pruneSnapshots(workspaceRoot)
        return commit
      }),
    )

  const snapshotFiles = Effect.fn('git thread workspaces snapshot files')(function* (target: string) {
    return yield* snapshotOf((yield* locate(target)).workspaceRoot)
  })

  const restoreFiles = Effect.fn('git thread workspaces restore files')(function* (target: string, snapshot: string) {
    if (!isObjectId(snapshot)) return yield* gitFailed('That snapshot is not a git commit id.')
    const location = yield* locate(target)
    return yield* locks.withRepo(location.repoRoot)(
      Effect.gen(function* () {
        const workspaceRoot = location.workspaceRoot
        if ((yield* run(['cat-file', '-e', `${snapshot}^{commit}`], workspaceRoot)).exitCode !== 0)
          return yield* gitFailed(
            `That snapshot is no longer in this repository: DSH keeps the newest ${String(MAX_SNAPSHOT_REFS)} file snapshots per repository, and git may have collected older ones. Undo a more recent turn, or recover the files from the thread's commits (\`git log\`, \`git reflog\`).`,
          )
        const previous = yield* snapshotOf(workspaceRoot)
        const added = (yield* git(['diff', '--name-only', '-z', '--diff-filter=A', snapshot, previous], workspaceRoot))
          .split('\0')
          .filter(file => file.length > 0)
        yield* Effect.forEach(added, file => removeTree(path.join(workspaceRoot, file)), { concurrency: 16, discard: true })
        yield* Effect.scoped(
          Effect.gen(function* () {
            const index = yield* scratchIndex('dsh-git-restore-')
            yield* git(['read-tree', snapshot], workspaceRoot, index)
            yield* git(['checkout-index', '--all', '--force'], workspaceRoot, index)
          }),
        )
        return previous
      }),
    )
  })

  const revisionGraph = Effect.fn('git thread workspaces revision graph')(function* (target: string) {
    const thread = yield* requireThread(target)
    const tip = yield* targetRef(thread.workspaceRoot)
    const output = yield* git(
      ['log', '--graph', `--max-count=${String(GRAPH_REVISIONS)}`, '--format=%h %D %s', '--decorate=short', 'HEAD', tip, '--'],
      thread.workspaceRoot,
    )
    return output.trimEnd()
  })

  return {
    vcs: 'git',
    threadsDirectory,
    locate,
    list,
    status,
    reviewHistory,
    provision,
    prewarm: () => Effect.void,
    branchPoint,
    restore,
    land,
    landAt,
    landVerified,
    discard,
    discardMany,
    secondaryWorkspaces,
    discardSecondaryMany,
    workingCopyChangedAt,
    danglingEmptyRevisions: () => Effect.succeed([]),
    untrackedEntries,
    removeUntrackedEntry,
    bookmarks,
    workingCopyCommitId,
    snapshotFiles,
    restoreFiles,
    revisionGraph,
  } satisfies ThreadWorkspacesBackend
})

/**
 * The git adapter of the thread-workspace port, for repositories without `.jj`: one `git worktree` per thread on a
 * `dsh/<name>` branch beside the repository, landing by rebase and a forward-only bookmark (branch) move.
 */
export class GitThreadWorkspaces extends Context.Service<GitThreadWorkspaces, ThreadWorkspacesBackend>()('@dshfiles/jj-integration/GitThreadWorkspaces') {
  static readonly layer = Layer.effect(
    GitThreadWorkspaces,
    Effect.map(make, backend => GitThreadWorkspaces.of(backend)),
  )
}
