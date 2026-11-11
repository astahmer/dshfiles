import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { pullRequestApi } from '@dshfiles/pull-requests/api'
import { Clock, Context, Effect, Layer, Ref } from 'effect'
import { BacklogGates } from './gates.js'

const issueOf = BacklogGates.issueOf

/** How long one pull-request list stays fresh; the pull-requests plugin itself polls GitHub every two minutes. */
const CACHE_MS = 30_000
/** Issues one refresh reads at most: the pull-requests plugin answers fifty per gh call. */
const ISSUE_READ_LIMIT = 100
/** A linked issue is read again once its last read is older than this. */
const ISSUE_STALE_MS = 4 * 60_000
const ISSUE_BACKOFF_MS = 5 * 60_000
const MAX_ISSUE_BACKOFF_MS = 60 * 60_000

export interface IssueBackoff {
  readonly until: number
  readonly count: number
}

/** After one issue read: a rate limit waits five minutes, doubling per consecutive limit up to an hour; a read that went through resets it. */
export const issueBackoffAfter = (input: { readonly previous: IssueBackoff; readonly now: number; readonly rateLimited: boolean }): IssueBackoff => {
  if (!input.rateLimited) return { until: 0, count: 0 }
  const count = input.previous.count + 1
  return { until: input.now + Math.min(ISSUE_BACKOFF_MS * 2 ** (count - 1), MAX_ISSUE_BACKOFF_MS), count }
}
/** Issue states kept in memory; the oldest reads go first past it. */
const MAX_CACHED_ISSUES = 2_000

export type PullRequestLiveState = 'open' | 'merged' | 'closed' | 'unknown'
export type PullRequestChecks = 'passing' | 'failing' | 'pending' | 'none'

/** What the backlog shows about one linked pull request. */
export interface PullRequestView {
  readonly url: string
  readonly repo: string
  readonly number: number
  readonly state: PullRequestLiveState
  readonly checks: PullRequestChecks
  /** A thread or the item watches it, so its state stays current. */
  readonly watched: boolean
  /** The pull request's description, as last polled; null when it predates the field. */
  readonly body: string | null
  /** When its state was last read from the forge; null when it never was. */
  readonly checkedAt: number | null
}

type IssueLiveState = 'open' | 'closed' | 'unknown'

/** What the backlog shows about one linked GitHub issue. */
export interface IssueView {
  readonly url: string
  readonly repo: string
  readonly number: number
  readonly state: IssueLiveState
  /** GitHub's close reason (COMPLETED, NOT_PLANNED, DUPLICATE…); null while open or unknown. */
  readonly reason: string | null
  readonly checkedAt: number | null
}

/** A pull request a backlog item watches through the pull-requests plugin. */
export interface ItemWatch {
  readonly itemId: number
  readonly url: string
}

const failing = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])
const pending = new Set(['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED'])

const checksOf = (checks: readonly { readonly status: string }[]): PullRequestChecks => {
  if (checks.length === 0) return 'none'
  if (checks.some(check => failing.has(check.status.toUpperCase()))) return 'failing'
  if (checks.some(check => pending.has(check.status.toUpperCase()))) return 'pending'
  return 'passing'
}

const liveStates = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' } as const satisfies Record<string, PullRequestLiveState>

const stateOf = (state: keyof typeof liveStates | undefined): PullRequestLiveState => (state === undefined ? 'unknown' : liveStates[state])

/**
 * Live pull-request state for the backlog's PR links and gates, read from `@dshfiles/pull-requests` (which owns the `gh`
 * polling) through its published contract. Absent that plugin, every PR link stays a plain URL.
 */
export class PullRequestState extends Context.Service<
  PullRequestState,
  {
    /** Whether the pull-requests plugin is loaded. */
    readonly available: Effect.Effect<boolean>
    /** What is known of these URLs; one that no thread watches comes back `unknown`. */
    readonly of: (urls: readonly string[]) => Effect.Effect<{ readonly available: boolean; readonly pullRequests: readonly PullRequestView[] }>
    /** Asks the pull-requests plugin to watch a PR for a thread, so its state is polled; false when it could not. */
    readonly watch: (input: { readonly url: string; readonly sessionId: string }) => Effect.Effect<boolean>
    /** Asks the pull-requests plugin to watch a PR for a backlog item, no thread needed; false when it could not. */
    readonly watchForItem: (input: { readonly itemId: number; readonly url: string; readonly cwd?: string | undefined }) => Effect.Effect<boolean>
    /** Releases a backlog item's watch of one PR, or of all its PRs. */
    readonly releaseItem: (input: { readonly itemId: number; readonly url?: string | undefined }) => Effect.Effect<void>
    /** Every PR the backlog's items watch; null when the pull-requests plugin cannot say (absent, or too old to own item watches). */
    readonly itemWatches: Effect.Effect<readonly ItemWatch[] | null>
    /** The last read state of these GitHub issue URLs; one never read comes back `unknown`. */
    readonly issues: (urls: readonly string[]) => Effect.Effect<readonly IssueView[]>
    /**
     * Reads the stale ones of these issue URLs (oldest read first, at most a hundred) through the pull-requests plugin.
     * A rate limit backs the next reads off, doubling up to an hour.
     */
    readonly refreshIssues: (urls: readonly string[]) => Effect.Effect<void>
  }
>()('@dshfiles/backlog/PullRequestState') {
  static readonly layer = Layer.effect(
    PullRequestState,
    Effect.gen(function* () {
      const apis = yield* HostApis
      const client = apis.client(pullRequestApi)
      const cache = yield* Ref.make<{ readonly at: number; readonly views: ReadonlyMap<string, PullRequestView> } | null>(null)
      const available = apis.isServed(pullRequestApi)

      const ownedOrEmpty = client.ownedWatches({ kind: 'backlog-item' }).pipe(
        Effect.map(listed => listed.watches),
        Effect.catch(() => Effect.succeed([])),
      )

      const known = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const cached = yield* Ref.get(cache)
        if (cached !== null && now - cached.at < CACHE_MS) return cached.views
        const [listed, owned] = yield* Effect.all([client.list({ all: true }), ownedOrEmpty], { concurrency: 2 })
        const views = new Map<string, PullRequestView>()
        // Thread links and item watches of one PR share its poll: the freshest known record speaks for it.
        for (const link of [...listed.links, ...owned]) {
          const pull = BacklogGates.pullRequestOf(link.url)
          if (pull === null) continue
          const previous = views.get(pull.url)
          const view: PullRequestView = {
            url: pull.url,
            repo: link.repo,
            number: link.number,
            state: stateOf(link.lastKnownState?.state),
            checks: checksOf(link.lastKnownState?.checks ?? []),
            watched: link.watching || (previous?.watched ?? false),
            body: link.lastKnownState?.body ?? previous?.body ?? null,
            checkedAt: link.lastCheckedAt,
          }
          const fresher =
            previous === undefined ||
            (previous.state === 'unknown' && view.state !== 'unknown') ||
            (view.state !== 'unknown' && (view.checkedAt ?? 0) > (previous.checkedAt ?? 0))
          if (fresher) views.set(pull.url, { ...view, watched: view.watched || (previous?.watched ?? false) })
          else if (previous !== undefined && view.watched && !previous.watched) views.set(pull.url, { ...previous, watched: true })
        }
        yield* Ref.set(cache, { at: now, views })
        return views
      }).pipe(Effect.withSpan('backlog pull request state read'))

      const of = Effect.fn('backlog pull request state')(function* (urls: readonly string[]) {
        const pulls = urls.flatMap(url => BacklogGates.pullRequestOf(url) ?? [])
        const served = yield* available
        const views =
          pulls.length === 0 || !served
            ? new Map<string, PullRequestView>()
            : yield* known.pipe(
                Effect.catch(error => Effect.as(Effect.logWarning('backlog: pull-request state is unavailable', error), new Map<string, PullRequestView>())),
              )
        return {
          available: served,
          pullRequests: pulls.map(
            (pull): PullRequestView =>
              views.get(pull.url) ?? {
                url: pull.url,
                repo: pull.repo,
                number: pull.number,
                state: 'unknown',
                checks: 'none',
                watched: false,
                body: null,
                checkedAt: null,
              },
          ),
        }
      })

      const watch = Effect.fn('backlog pull request watch')(function* (input: { readonly url: string; readonly sessionId: string }) {
        const pull = BacklogGates.pullRequestOf(input.url)
        if (pull === null || pull.host !== 'github' || !(yield* available)) return false
        yield* Ref.set(cache, null)
        return yield* client.watch({ url: pull.url, sessionId: input.sessionId }).pipe(
          Effect.as(true),
          Effect.catch(error => Effect.as(Effect.logWarning('backlog: the pull request was linked but not watched', error), false)),
        )
      })

      const ownerOf = (itemId: number) => ({ kind: 'backlog-item' as const, id: String(itemId) })

      const watchForItem = Effect.fn('backlog pull request item watch')(function* (input: {
        readonly itemId: number
        readonly url: string
        readonly cwd?: string | undefined
      }) {
        const pull = BacklogGates.pullRequestOf(input.url)
        if (pull === null || !(yield* available)) return false
        yield* Ref.set(cache, null)
        return yield* client
          .watchFor({ owner: ownerOf(input.itemId), url: pull.url, ...(input.cwd !== undefined && input.cwd.length > 0 && { cwd: input.cwd }) })
          .pipe(
            Effect.as(true),
            Effect.catch(error => Effect.as(Effect.logWarning('backlog: the pull request could not be watched for its item', error), false)),
          )
      })

      const releaseItem = Effect.fn('backlog pull request item release')(function* (input: { readonly itemId: number; readonly url?: string | undefined }) {
        if (!(yield* available)) return
        yield* Ref.set(cache, null)
        yield* client
          .unwatchFor({ owner: ownerOf(input.itemId), ...(input.url !== undefined && { url: input.url }) })
          .pipe(Effect.catch(error => Effect.logWarning('backlog: an item watch was not released', error)))
      })

      const itemWatches = Effect.gen(function* () {
        if (!(yield* available)) return null
        return yield* client.ownedWatches({ kind: 'backlog-item' }).pipe(
          Effect.map(listed =>
            listed.watches.flatMap((watch): ItemWatch[] => {
              const itemId = Number(watch.owner.id)
              return Number.isSafeInteger(itemId) ? [{ itemId, url: watch.url }] : []
            }),
          ),
          Effect.catch(() => Effect.succeed(null)),
        )
      }).pipe(Effect.withSpan('backlog pull request item watches'))

      const issueCache = yield* Ref.make<ReadonlyMap<string, IssueView>>(new Map())
      const issueBackoff = yield* Ref.make<IssueBackoff>({ until: 0, count: 0 })

      const issues = Effect.fn('backlog issue state')(function* (urls: readonly string[]) {
        const cached = yield* Ref.get(issueCache)
        return urls.flatMap(url => {
          const issue = issueOf(url)
          if (issue === null) return []
          return [cached.get(issue.url) ?? { ...issue, state: 'unknown' as const, reason: null, checkedAt: null }]
        })
      })

      const refreshIssues = Effect.fn('backlog issue state refresh')(function* (urls: readonly string[]) {
        const now = yield* Clock.currentTimeMillis
        const backoff = yield* Ref.get(issueBackoff)
        if (backoff.until > now) return yield* Effect.annotateCurrentSpan('dshx.backlog.issues', 'backoff')
        if (!(yield* available)) return
        const cached = yield* Ref.get(issueCache)
        const stale = [...new Set(urls.flatMap(url => issueOf(url)?.url ?? []))]
          .map(url => ({ url, checkedAt: cached.get(url)?.checkedAt ?? 0 }))
          .filter(entry => now - entry.checkedAt >= ISSUE_STALE_MS)
          .sort((left, right) => left.checkedAt - right.checkedAt)
          .slice(0, ISSUE_READ_LIMIT)
          .map(entry => entry.url)
        yield* Effect.annotateCurrentSpan({ 'dshx.backlog.issues': stale.length })
        if (stale.length === 0) return
        const read = yield* client
          .issueStates({ urls: stale })
          .pipe(Effect.catch(error => Effect.as(Effect.logWarning('backlog: issue states are unavailable', error), null)))
        if (read === null) return
        const nextBackoff = issueBackoffAfter({ previous: backoff, now, rateLimited: read.rateLimited })
        yield* Ref.set(issueBackoff, nextBackoff)
        if (read.rateLimited) yield* Effect.logWarning('backlog: GitHub rate-limited issue reads; backing off', { consecutiveRateLimits: nextBackoff.count })
        yield* Ref.update(issueCache, previous => {
          const next = new Map(previous)
          for (const answer of read.issues) {
            const issue = issueOf(answer.url)
            if (issue === null) continue
            next.set(issue.url, { ...issue, state: answer.state === 'OPEN' ? 'open' : 'closed', reason: answer.stateReason, checkedAt: answer.checkedAt })
          }
          if (next.size <= MAX_CACHED_ISSUES) return next
          return new Map([...next].sort(([, left], [, right]) => (right.checkedAt ?? 0) - (left.checkedAt ?? 0)).slice(0, MAX_CACHED_ISSUES))
        })
      })

      return PullRequestState.of({ available, of, watch, watchForItem, releaseItem, itemWatches, issues, refreshIssues })
    }),
  )
}
