import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { pullRequestApi } from '@dshfiles/pull-requests/api'
import { Clock, Context, Effect, Layer, Ref } from 'effect'
import { BacklogGates } from './gates.js'

/** How long one pull-request list stays fresh; the pull-requests plugin itself polls GitHub every two minutes. */
const CACHE_MS = 30_000

export type PullRequestLiveState = 'open' | 'merged' | 'closed' | 'unknown'
export type PullRequestChecks = 'passing' | 'failing' | 'pending' | 'none'

/** What the backlog shows about one linked pull request. */
export interface PullRequestView {
  readonly url: string
  readonly repo: string
  readonly number: number
  readonly state: PullRequestLiveState
  readonly checks: PullRequestChecks
  /** A thread watches it, so its state stays current. */
  readonly watched: boolean
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
  }
>()('@dshfiles/backlog/PullRequestState') {
  static readonly layer = Layer.effect(
    PullRequestState,
    Effect.gen(function* () {
      const apis = yield* HostApis
      const client = apis.client(pullRequestApi)
      const cache = yield* Ref.make<{ readonly at: number; readonly views: ReadonlyMap<string, PullRequestView> } | null>(null)
      const available = apis.isServed(pullRequestApi)

      const known = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const cached = yield* Ref.get(cache)
        if (cached !== null && now - cached.at < CACHE_MS) return cached.views
        const listed = yield* client.list({ all: true })
        const views = new Map<string, PullRequestView>()
        for (const link of listed.links) {
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
          }
          if (previous === undefined || (previous.state === 'unknown' && view.state !== 'unknown')) views.set(pull.url, view)
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
              views.get(pull.url) ?? { url: pull.url, repo: pull.repo, number: pull.number, state: 'unknown', checks: 'none', watched: false },
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

      return PullRequestState.of({ available, of, watch })
    }),
  )
}
