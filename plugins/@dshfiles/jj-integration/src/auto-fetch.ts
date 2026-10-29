import { withSpan } from '@dshfiles/dshx/tracing'
import type { JjIntegrationSettings } from './settings.js'
import type { JjExecutor } from './threads.js'

type AutoFetchSettings = JjIntegrationSettings['autoFetch']

export type FetchOutcome =
  | { readonly status: 'no-remote'; readonly repoRoot: string }
  | { readonly status: 'fetched'; readonly repoRoot: string; readonly bookmarkMoved: boolean }
  | { readonly status: 'fast-forwarded'; readonly repoRoot: string; readonly from: string; readonly to: string }
  | { readonly status: 'failed'; readonly repoRoot: string; readonly step: 'remote-list' | 'fetch' | 'fast-forward'; readonly message: string }

/** Long enough that DSH finishes booting and its first repository scan before the network is touched. */
export const AUTO_FETCH_FIRST_RUN_DELAY_MS = 2 * 60_000

const errorExcerpt = (text: string): string => text.trim().split('\n').slice(-3).join(' ').slice(0, 400)

const commitOf = async (input: { readonly execute: JjExecutor; readonly repoRoot: string; readonly revset: string }): Promise<string | undefined> => {
  const result = await input.execute({
    args: ['--ignore-working-copy', 'log', '--no-graph', '-r', input.revset, '-T', 'commit_id ++ "\\n"'],
    cwd: input.repoRoot,
  })
  if (result.exitCode !== 0) return undefined
  const lines = result.stdout.split('\n').filter(line => line.length > 0)
  return lines.length === 1 ? lines[0] : undefined
}

const exactBookmark = (bookmark: string): string => `bookmarks(exact:${JSON.stringify(bookmark)})`
const exactRemoteBookmark = (bookmark: string, remote: string): string => `remote_bookmarks(exact:${JSON.stringify(bookmark)}, exact:${JSON.stringify(remote)})`

/**
 * Fetches one remote of one repository, then optionally fast-forwards the local bookmark to its remote copy. The
 * bookmark moves only when it is a strict ancestor of the remote copy, so local commits are never dropped or rebased.
 */
const fetchRepository = (input: {
  readonly execute: JjExecutor
  readonly repoRoot: string
  readonly remote: string
  readonly bookmark: string
  readonly fastForward: boolean
}): Promise<FetchOutcome> =>
  withSpan('jj-integration auto fetch', { attributes: { 'dshx.fetch.fast_forward': input.fastForward } }, async span => {
    const outcome = await fetchUntraced(input)
    span.setAttributes({ 'dshx.fetch.status': outcome.status })
    if (outcome.status === 'failed') span.setStatus('error', `${outcome.step} failed`)
    return outcome
  })

const fetchUntraced = async (input: {
  readonly execute: JjExecutor
  readonly repoRoot: string
  readonly remote: string
  readonly bookmark: string
  readonly fastForward: boolean
}): Promise<FetchOutcome> => {
  const repoRoot = input.repoRoot
  const remotes = await input.execute({ args: ['--ignore-working-copy', 'git', 'remote', 'list'], cwd: repoRoot })
  if (remotes.exitCode !== 0) return { status: 'failed', repoRoot, step: 'remote-list', message: errorExcerpt(remotes.stderr) }
  const names = remotes.stdout.split('\n').map(line => line.split(/\s+/u)[0] ?? '')
  if (!names.includes(input.remote)) return { status: 'no-remote', repoRoot }
  const before = await commitOf({ execute: input.execute, repoRoot, revset: exactBookmark(input.bookmark) })
  const fetched = await input.execute({ args: ['--ignore-working-copy', 'git', 'fetch', '--remote', input.remote], cwd: repoRoot })
  if (fetched.exitCode !== 0) return { status: 'failed', repoRoot, step: 'fetch', message: errorExcerpt(fetched.stderr) }
  const afterFetch = await commitOf({ execute: input.execute, repoRoot, revset: exactBookmark(input.bookmark) })
  if (!input.fastForward || afterFetch === undefined) return { status: 'fetched', repoRoot, bookmarkMoved: before !== afterFetch }
  const remoteTip = await commitOf({ execute: input.execute, repoRoot, revset: exactRemoteBookmark(input.bookmark, input.remote) })
  if (remoteTip === undefined || remoteTip === afterFetch) return { status: 'fetched', repoRoot, bookmarkMoved: before !== afterFetch }
  const ancestor = await commitOf({
    execute: input.execute,
    repoRoot,
    revset: `${exactBookmark(input.bookmark)} & ::${exactRemoteBookmark(input.bookmark, input.remote)}`,
  })
  if (ancestor === undefined) return { status: 'fetched', repoRoot, bookmarkMoved: before !== afterFetch }
  const moved = await input.execute({ args: ['--ignore-working-copy', 'bookmark', 'set', input.bookmark, '-r', remoteTip], cwd: repoRoot })
  if (moved.exitCode !== 0) return { status: 'failed', repoRoot, step: 'fast-forward', message: errorExcerpt(moved.stderr) }
  return { status: 'fast-forwarded', repoRoot, from: afterFetch, to: remoteTip }
}

const scheduleTimeout = (run: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(run, delayMs)
  timer.unref()
  return () => clearTimeout(timer)
}

/**
 * Fetches every registered repository on the configured interval. Settings are read at each run, so turning it on,
 * changing the remote or the interval applies from the next tick; a disabled setting keeps the timer idle.
 */
export const createAutoFetchScheduler = (options: {
  readonly settings: () => AutoFetchSettings
  readonly bookmark: () => string
  readonly repositories: () => Promise<readonly string[]>
  readonly execute: JjExecutor
  readonly report: (outcome: FetchOutcome) => void
  readonly firstRunDelayMs?: number
  readonly schedule?: (run: () => void, delayMs: number) => () => void
  readonly onError?: (error: unknown) => void
}) => {
  const schedule = options.schedule ?? scheduleTimeout
  let cancel: (() => void) | undefined
  let disposed = false

  const runOnce = async (): Promise<readonly FetchOutcome[]> => {
    const settings = options.settings()
    if (!settings.enabled) return []
    const outcomes: FetchOutcome[] = []
    // One repository at a time: each fetch is network-bound and a project list is small, so serial keeps load flat.
    for (const repoRoot of await options.repositories()) {
      if (disposed) break
      const outcome = await fetchRepository({
        execute: options.execute,
        repoRoot,
        remote: settings.remote,
        bookmark: options.bookmark(),
        fastForward: settings.fastForwardBookmark,
      })
      options.report(outcome)
      outcomes.push(outcome)
    }
    return outcomes
  }

  const arm = (delayMs: number): void => {
    if (disposed) return
    cancel = schedule(() => {
      void runOnce()
        .catch((error: unknown) => options.onError?.(error))
        .finally(() => arm(options.settings().intervalMinutes * 60_000))
    }, delayMs)
  }

  arm(options.firstRunDelayMs ?? AUTO_FETCH_FIRST_RUN_DELAY_MS)

  return {
    runOnce,
    dispose: (): void => {
      disposed = true
      cancel?.()
      cancel = undefined
    },
  }
}

export class AutoFetchModel {
  static readonly fetchRepository = fetchRepository
  /** The activity line for a failed fetch, with the command that reproduces it and the setting that stops it. */
  static readonly failureDetail = (outcome: Extract<FetchOutcome, { status: 'failed' }>, remote: string): string =>
    `${outcome.message || `jj git ${outcome.step} exited with an error`} — run \`jj git fetch --remote ${remote}\` in ${outcome.repoRoot} to see the full error (network, credentials or remote URL), or turn off Settings › jj-integration › autoFetch.`
}
