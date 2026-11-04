import { Git, redactGitStderr } from '@dshfiles/git-cli'
import { Jj } from '@dshfiles/jj-cli'
import { Duration, Effect, Option, Schema } from 'effect'

export type FetchOutcome =
  | { readonly status: 'no-remote'; readonly repoRoot: string }
  | { readonly status: 'fetched'; readonly repoRoot: string; readonly bookmarkMoved: boolean }
  | { readonly status: 'fast-forwarded'; readonly repoRoot: string; readonly from: string; readonly to: string }
  | {
      readonly status: 'failed'
      readonly repoRoot: string
      readonly step: 'remote-list' | 'fetch' | 'fast-forward'
      readonly message: string
      /** Set for a git-only repository, so the recovery hint names the git command. */
      readonly vcs?: 'git' | undefined
    }

/** Long enough that DSH finishes booting and its first repository scan before the network is touched. */
export const AUTO_FETCH_FIRST_RUN_DELAY = Duration.minutes(2)
/** A fetch is network-bound; one stuck remote must not hold every later run. */
const FETCH_TIMEOUT = Duration.minutes(2)

const errorExcerpt = (text: string): string => text.trim().split('\n').slice(-3).join(' ').slice(0, 400)

const exactBookmark = (bookmark: string): string => `bookmarks(exact:${JSON.stringify(bookmark)})`
const exactRemoteBookmark = (bookmark: string, remote: string): string => `remote_bookmarks(exact:${JSON.stringify(bookmark)}, exact:${JSON.stringify(remote)})`

/** Fails the fetch span so a failed run reads as an error; the caller gets the outcome back as a value. */
class FetchFailed extends Schema.TaggedError<FetchFailed>()('FetchFailed', {
  repoRoot: Schema.String,
  step: Schema.Literals(['remote-list', 'fetch', 'fast-forward']),
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `jj git ${this.step} failed in ${this.repoRoot}.`
  }
}

/** A failed spawn or a timeout reads like the command exiting with that message, so it is reported on the same path. */
const run = (args: readonly string[], cwd: string) =>
  Effect.gen(function* () {
    const jj = yield* Jj
    return yield* jj.run({ args, cwd, timeout: FETCH_TIMEOUT })
  }).pipe(Effect.catch(error => Effect.succeed({ exitCode: 1, stdout: '', stdoutTruncated: false, stderr: error.message, stderrTruncated: false })))

const commitOf = (input: { readonly repoRoot: string; readonly revset: string }) =>
  Effect.map(run(['--ignore-working-copy', 'log', '--no-graph', '-r', input.revset, '-T', 'commit_id ++ "\\n"'], input.repoRoot), result => {
    if (result.exitCode !== 0) return Option.none<string>()
    const lines = result.stdout.split('\n').filter(line => line.length > 0)
    return lines.length === 1 ? Option.fromUndefinedOr(lines[0]) : Option.none<string>()
  })

/**
 * Fetches one remote of one repository, then optionally fast-forwards the local bookmark to its remote copy. The
 * bookmark moves only when it is a strict ancestor of the remote copy, so local commits are never dropped or rebased.
 */
const fetchRepository = (input: { readonly repoRoot: string; readonly remote: string; readonly bookmark: string; readonly fastForward: boolean }) =>
  fetchUntraced(input).pipe(
    Effect.tap(outcome => Effect.annotateCurrentSpan({ 'dshx.fetch.status': outcome.status })),
    Effect.flatMap(outcome =>
      outcome.status === 'failed'
        ? Effect.fail(new FetchFailed({ repoRoot: outcome.repoRoot, step: outcome.step, detail: outcome.message }))
        : Effect.succeed(outcome),
    ),
    Effect.withSpan('jj-integration auto fetch', { attributes: { 'dshx.fetch.fast_forward': input.fastForward } }),
    Effect.catchTag('FetchFailed', (failed): Effect.Effect<FetchOutcome> =>
      Effect.succeed({ status: 'failed', repoRoot: failed.repoRoot, step: failed.step, message: failed.detail }),
    ),
  )

/** One git run; a failed spawn or a timeout reads as an exit with that message, like the jj runner above. */
const runGit = (args: readonly string[], cwd: string) =>
  Effect.gen(function* () {
    const git = yield* Git
    return yield* git.run({ args, cwd, timeout: FETCH_TIMEOUT })
  }).pipe(Effect.catch(error => Effect.succeed({ exitCode: 1, stdout: '', stdoutTruncated: false, stderr: error.message })))

const gitCommitOf = (repoRoot: string, ref: string) =>
  Effect.map(runGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repoRoot), result =>
    result.exitCode === 0 && result.stdout.trim().length > 0 ? Option.some(result.stdout.trim()) : Option.none<string>(),
  )

const gitFailure = (repoRoot: string, step: 'remote-list' | 'fetch' | 'fast-forward', stderr: string): FetchOutcome => ({
  status: 'failed',
  repoRoot,
  step,
  // A remote URL in git's stderr can carry credentials; this text reaches the activity log.
  message: errorExcerpt(redactGitStderr(stderr)),
  vcs: 'git',
})

/**
 * git's counterpart of the jj fetch: `git fetch <remote>` refreshes `<remote>/<bookmark>` and never moves a local
 * branch, so the bookmark moves only through the opt-in fast-forward. That moves it only when the local branch is an
 * ancestor of the remote one; where it is checked out, its worktree fast-forwards so its files follow, and a worktree
 * whose edits block that keeps the branch where it was.
 */
const fetchGitUntraced = Effect.fnUntraced(function* (input: {
  readonly repoRoot: string
  readonly remote: string
  readonly bookmark: string
  readonly fastForward: boolean
}) {
  const repoRoot = input.repoRoot
  const remotes = yield* runGit(['remote'], repoRoot)
  if (remotes.exitCode !== 0) return gitFailure(repoRoot, 'remote-list', remotes.stderr)
  if (
    !remotes.stdout
      .split('\n')
      .map(line => line.trim())
      .includes(input.remote)
  )
    return { status: 'no-remote', repoRoot } satisfies FetchOutcome
  const fetched = yield* runGit(['fetch', '--quiet', input.remote], repoRoot)
  if (fetched.exitCode !== 0) return gitFailure(repoRoot, 'fetch', fetched.stderr)
  const local = yield* gitCommitOf(repoRoot, `refs/heads/${input.bookmark}`)
  const remoteTip = yield* gitCommitOf(repoRoot, `refs/remotes/${input.remote}/${input.bookmark}`)
  if (!input.fastForward || Option.isNone(local) || Option.isNone(remoteTip) || local.value === remoteTip.value)
    return { status: 'fetched', repoRoot, bookmarkMoved: false } satisfies FetchOutcome
  const ancestor = yield* runGit(['merge-base', '--is-ancestor', local.value, remoteTip.value], repoRoot)
  if (ancestor.exitCode !== 0) return { status: 'fetched', repoRoot, bookmarkMoved: false } satisfies FetchOutcome
  const worktrees = yield* runGit(['worktree', 'list', '--porcelain'], repoRoot)
  const holder = worktrees.stdout
    .split('\n\n')
    .map(block => block.split('\n'))
    .find(lines => lines.includes(`branch refs/heads/${input.bookmark}`))
    ?.find(line => line.startsWith('worktree '))
    ?.slice('worktree '.length)
  const moved =
    holder === undefined
      ? yield* runGit(['update-ref', `refs/heads/${input.bookmark}`, remoteTip.value, local.value], repoRoot)
      : yield* runGit(['merge', '--ff-only', '--no-edit', remoteTip.value], holder)
  if (moved.exitCode !== 0) return gitFailure(repoRoot, 'fast-forward', moved.stderr)
  return { status: 'fast-forwarded', repoRoot, from: local.value, to: remoteTip.value } satisfies FetchOutcome
})

const fetchGitRepository = (input: { readonly repoRoot: string; readonly remote: string; readonly bookmark: string; readonly fastForward: boolean }) =>
  fetchGitUntraced(input).pipe(
    Effect.tap(outcome => Effect.annotateCurrentSpan({ 'dshx.fetch.status': outcome.status })),
    Effect.flatMap(outcome =>
      outcome.status === 'failed'
        ? Effect.fail(new FetchFailed({ repoRoot: outcome.repoRoot, step: outcome.step, detail: outcome.message }))
        : Effect.succeed(outcome),
    ),
    Effect.withSpan('jj-integration auto fetch', { attributes: { 'dshx.fetch.fast_forward': input.fastForward, 'dshx.fetch.vcs': 'git' } }),
    Effect.catchTag('FetchFailed', (failed): Effect.Effect<FetchOutcome> =>
      Effect.succeed({ status: 'failed', repoRoot: failed.repoRoot, step: failed.step, message: failed.detail, vcs: 'git' }),
    ),
  )

const fetchUntraced = Effect.fnUntraced(function* (input: {
  readonly repoRoot: string
  readonly remote: string
  readonly bookmark: string
  readonly fastForward: boolean
}) {
  const repoRoot = input.repoRoot
  const remotes = yield* run(['--ignore-working-copy', 'git', 'remote', 'list'], repoRoot)
  if (remotes.exitCode !== 0) return { status: 'failed', repoRoot, step: 'remote-list', message: errorExcerpt(remotes.stderr) } satisfies FetchOutcome
  const names = remotes.stdout.split('\n').map(line => line.split(/\s+/u)[0] ?? '')
  if (!names.includes(input.remote)) return { status: 'no-remote', repoRoot } satisfies FetchOutcome
  const before = yield* commitOf({ repoRoot, revset: exactBookmark(input.bookmark) })
  const fetched = yield* run(['--ignore-working-copy', 'git', 'fetch', '--remote', input.remote], repoRoot)
  if (fetched.exitCode !== 0) return { status: 'failed', repoRoot, step: 'fetch', message: errorExcerpt(fetched.stderr) } satisfies FetchOutcome
  const afterFetch = yield* commitOf({ repoRoot, revset: exactBookmark(input.bookmark) })
  const bookmarkMoved = Option.getOrUndefined(before) !== Option.getOrUndefined(afterFetch)
  if (!input.fastForward || Option.isNone(afterFetch)) return { status: 'fetched', repoRoot, bookmarkMoved } satisfies FetchOutcome
  const remoteTip = yield* commitOf({ repoRoot, revset: exactRemoteBookmark(input.bookmark, input.remote) })
  if (Option.isNone(remoteTip) || remoteTip.value === afterFetch.value) return { status: 'fetched', repoRoot, bookmarkMoved } satisfies FetchOutcome
  const ancestor = yield* commitOf({ repoRoot, revset: `${exactBookmark(input.bookmark)} & ::${exactRemoteBookmark(input.bookmark, input.remote)}` })
  if (Option.isNone(ancestor)) return { status: 'fetched', repoRoot, bookmarkMoved } satisfies FetchOutcome
  const moved = yield* run(['--ignore-working-copy', 'bookmark', 'set', input.bookmark, '-r', remoteTip.value], repoRoot)
  if (moved.exitCode !== 0) return { status: 'failed', repoRoot, step: 'fast-forward', message: errorExcerpt(moved.stderr) } satisfies FetchOutcome
  return { status: 'fast-forwarded', repoRoot, from: afterFetch.value, to: remoteTip.value } satisfies FetchOutcome
})

export class AutoFetchModel {
  static readonly fetchRepository = fetchRepository
  static readonly fetchGitRepository = fetchGitRepository
  /** The activity line for a failed fetch, with the command that reproduces it and the setting that stops it. */
  static readonly failureDetail = (outcome: Extract<FetchOutcome, { status: 'failed' }>, remote: string): string => {
    const command = outcome.vcs === 'git' ? `git fetch ${remote}` : `jj git fetch --remote ${remote}`
    const fallback = outcome.vcs === 'git' ? `git ${outcome.step} exited with an error` : `jj git ${outcome.step} exited with an error`
    return `${outcome.message || fallback} — run \`${command}\` in ${outcome.repoRoot} to see the full error (network, credentials or remote URL), or turn off Settings › jj-integration › autoFetch.`
  }
}
