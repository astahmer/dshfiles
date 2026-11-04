import { Jj } from '@dshfiles/jj-cli'
import { Duration, Effect, Option, Schema } from 'effect'

export type FetchOutcome =
  | { readonly status: 'no-remote'; readonly repoRoot: string }
  | { readonly status: 'fetched'; readonly repoRoot: string; readonly bookmarkMoved: boolean }
  | { readonly status: 'fast-forwarded'; readonly repoRoot: string; readonly from: string; readonly to: string }
  | { readonly status: 'failed'; readonly repoRoot: string; readonly step: 'remote-list' | 'fetch' | 'fast-forward'; readonly message: string }

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
  /** The activity line for a failed fetch, with the command that reproduces it and the setting that stops it. */
  static readonly failureDetail = (outcome: Extract<FetchOutcome, { status: 'failed' }>, remote: string): string =>
    `${outcome.message || `jj git ${outcome.step} exited with an error`} — run \`jj git fetch --remote ${remote}\` in ${outcome.repoRoot} to see the full error (network, credentials or remote URL), or turn off Settings › jj-integration › autoFetch.`
}
