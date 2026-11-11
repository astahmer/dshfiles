import type { ApiCaller } from '@dshfiles/dshx/api'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { StorageDomainReadFailed, StorageDomainWriteFailed } from '@dshfiles/dshx/effect/storage-domain'
import { threadActionsApi } from '@dshfiles/thread-sidebar/thread-actions-api'
import { threadSidebarAutoSettleApi } from '@dshfiles/thread-sidebar/auto-settle-api'
import { Clock, Context, Effect, Layer, Schema } from 'effect'
import { GhCommandFailed, GhResponseInvalid } from './github-cli.js'
import { GlabCommandFailed, GlabResponseInvalid } from './gitlab-cli.js'
import { forgeTargetOf, parseForgePullRequestUrl, pullRequestUrlOf, repositoryKeyOf } from './forge.js'
import { ForgePullRequests, UnsupportedRepository, type ForgeFailure } from './forge-port.js'
import {
  summarizePullRequest,
  transitionPullRequest,
  PullRequestWatcher,
  type PullRequestEvent,
  type PullRequestLinkInput,
  type PullRequestRecord,
  type PullRequestSnapshot,
  type PullRequestTargetInput,
  type PullRequestTransition,
  type GitHubPullRequestView,
  type OwnedWatchRecord,
  type OwnedWatchView,
  type WatchOwner,
} from './pull-request-model.js'
import { PullRequestStore } from './store.js'

type PullRequestPollResult = { readonly kind: 'success'; readonly value: GitHubPullRequestView } | { readonly kind: 'failure'; readonly error: ForgeFailure }

const capturePullRequestResult = (effect: Effect.Effect<GitHubPullRequestView, ForgeFailure>) =>
  effect.pipe(
    Effect.map((value): PullRequestPollResult => ({ kind: 'success', value })),
    Effect.catch((error): Effect.Effect<PullRequestPollResult> => Effect.succeed({ kind: 'failure', error })),
  )

const POLL_INTERVAL_MS = 2 * 60_000
const MAX_BACKOFF_MS = 60 * 60_000
/** Watched pull requests polled at once: one `gh` call each, kept modest for GitHub's API budget. */
const POLL_CONCURRENCY = 6
const SETTLE_SOURCE = '@dshfiles/pull-requests'
/** An event-driven refresh skips a pull request checked this recently: a burst of thread events costs one `gh` call. */
export const EVENT_REFRESH_MIN_AGE_MS = 20_000

const pullRequestKey = (record: Pick<PullRequestRecord, 'repo' | 'number'>): string => `${record.repo.toLowerCase()}#${String(record.number)}`

export class PullRequestSessionRequired extends Schema.TaggedError<PullRequestSessionRequired>()('PullRequestSessionRequired', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason
  }
}

export class PullRequestLocatorInvalid extends Schema.TaggedError<PullRequestLocatorInvalid>()('PullRequestLocatorInvalid', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason
  }
}

export class PullRequestLinkNotFound extends Schema.TaggedError<PullRequestLinkNotFound>()('PullRequestLinkNotFound', {
  sessionId: Schema.String,
  repo: Schema.String,
  number: Schema.Number,
}) {
  override get message(): string {
    return `No pull-request link exists for ${this.repo}#${String(this.number)} in thread ${this.sessionId}.`
  }
}

export type PullRequestMonitorError =
  | PullRequestSessionRequired
  | PullRequestLocatorInvalid
  | PullRequestLinkNotFound
  | GhCommandFailed
  | GhResponseInvalid
  | GlabCommandFailed
  | GlabResponseInvalid
  | UnsupportedRepository
  | StorageDomainReadFailed
  | StorageDomainWriteFailed

const linkId = (input: { readonly sessionId: string; readonly repo: string; readonly number: number }): string =>
  `${encodeURIComponent(input.sessionId)}::${input.repo.toLowerCase()}#${String(input.number)}`

export const sessionFor = (provided: string | undefined, caller: ApiCaller): Effect.Effect<string, PullRequestSessionRequired> => {
  if (provided !== undefined) return Effect.succeed(provided)
  if (caller.kind === 'agent' && caller.sessionId !== undefined) return Effect.succeed(caller.sessionId)
  return Effect.fail(new PullRequestSessionRequired({ reason: 'Pass a session id when the call is not made from a thread.' }))
}

export const cwdForCaller = (caller: ApiCaller): string => (caller.kind === 'agent' ? (caller.cwd ?? '') : '')

const parsePullRequestUrl = (url: string): { readonly repo: string; readonly number: number; readonly url: string } | undefined => {
  const target = parseForgePullRequestUrl(url)
  if (target === undefined) return undefined
  return { repo: repositoryKeyOf(target), number: target.number, url: target.url }
}

const eventLabel = (event: PullRequestEvent): string => `${event.author === null ? 'unknown author' : `@${event.author}`} at ${event.at}`

const transitionFact = (transition: PullRequestTransition): string => {
  if (transition.kind === 'ci-failed') return `CI failed: ${String(transition.count)} check(s).`
  if (transition.kind === 'required-checks-passed') return 'GitHub reports all returned checks passed and the merge state is clean.'
  if (transition.kind === 'new-comment') return `${String(transition.count)} new comment(s); latest from ${eventLabel(transition.event)}.`
  if (transition.kind === 'new-review') return `${String(transition.count)} new review(s); latest from ${eventLabel(transition.event)}.`
  if (transition.kind === 'conflicting') return 'The pull request became conflicting.'
  if (transition.kind === 'merged') return 'The pull request was merged.'
  return 'The pull request was closed without merging.'
}

const transitionMessage = (input: {
  readonly link: PullRequestRecord
  readonly snapshot: PullRequestSnapshot
  readonly transitions: readonly PullRequestTransition[]
}): string => {
  const facts = input.transitions.map(transitionFact).join('\n- ')
  return [
    `GitHub update for ${input.link.repo}#${String(input.link.number)} (${input.link.url}):`,
    `- ${facts}`,
    `State: ${input.snapshot.state}; mergeability: ${input.snapshot.mergeable}; merge state: ${input.snapshot.mergeStateStatus}; review: ${input.snapshot.reviewDecision ?? 'none'}.`,
  ].join('\n')
}

const ownedWatchId = (input: { readonly owner: WatchOwner; readonly repo: string; readonly number: number }): string =>
  `${input.owner.kind}:${encodeURIComponent(input.owner.id)}::${input.repo.toLowerCase()}#${String(input.number)}`

export const ownedWatchViewOf = (record: OwnedWatchRecord): OwnedWatchView => ({
  owner: record.owner,
  repo: record.repo,
  number: record.number,
  url: record.url,
  watching: record.watching,
  lastKnownState: record.lastKnownState,
  lastCheckedAt: record.lastCheckedAt,
  lastError: record.lastError,
})

const backoffDelay = (consecutiveRateLimits: number): number =>
  Math.min(POLL_INTERVAL_MS * 2 ** Math.min(Math.max(0, consecutiveRateLimits - 1), 8), MAX_BACKOFF_MS)

const samePullRequest = (left: Pick<PullRequestRecord, 'repo' | 'number'>, right: Pick<PullRequestRecord, 'repo' | 'number'>): boolean =>
  left.repo.toLowerCase() === right.repo.toLowerCase() && left.number === right.number

const recordFor = (input: {
  readonly sessionId: string
  readonly repo: string
  readonly number: number
  readonly url: string
  readonly cwd: string
  readonly watching: boolean
}): PullRequestRecord => ({
  ...input,
  id: linkId(input),
  lastKnownState: null,
  lastCheckedAt: null,
  retryAfterAt: null,
  consecutiveRateLimits: 0,
  lastError: null,
})

export class PullRequestMonitor extends Context.Service<
  PullRequestMonitor,
  {
    readonly link: (input: PullRequestLinkInput, caller: ApiCaller) => Effect.Effect<PullRequestRecord, PullRequestMonitorError>
    readonly unlink: (
      input: PullRequestTargetInput,
      caller: ApiCaller,
    ) => Effect.Effect<
      {
        readonly sessionId: string
        readonly repo: string
        readonly number: number
        readonly removed: boolean
      },
      PullRequestMonitorError
    >
    readonly list: (
      input: { readonly sessionId?: string | undefined; readonly all?: boolean | undefined },
      caller: ApiCaller,
    ) => Effect.Effect<{ readonly links: readonly PullRequestRecord[]; readonly total: number; readonly all: boolean }, PullRequestMonitorError>
    readonly watch: (input: PullRequestLinkInput, caller: ApiCaller) => Effect.Effect<PullRequestRecord, PullRequestMonitorError>
    readonly unwatch: (input: PullRequestTargetInput, caller: ApiCaller) => Effect.Effect<PullRequestRecord, PullRequestMonitorError>
    /**
     * Watch a pull request for an owner that is not a thread (a backlog item): the sweep polls it with the thread links,
     * and a new watch is polled at once unless GitHub is rate-limiting the watcher. It never prompts or settles a thread.
     */
    readonly watchFor: (input: {
      readonly owner: WatchOwner
      readonly url: string
      readonly cwd?: string | undefined
    }) => Effect.Effect<OwnedWatchRecord, PullRequestMonitorError>
    /** Release an owner's watch of one pull request, or of every pull request when no URL is given; answers how many were released. */
    readonly unwatchFor: (input: { readonly owner: WatchOwner; readonly url?: string | undefined }) => Effect.Effect<number, PullRequestMonitorError>
    /** Every watch held by owners of this kind, with each pull request's last known state. */
    readonly ownedWatches: (input: { readonly kind: WatchOwner['kind'] }) => Effect.Effect<readonly OwnedWatchRecord[], PullRequestMonitorError>
    readonly pollAll: Effect.Effect<void, PullRequestMonitorError>
    /**
     * Poll the watched pull requests these threads link, now, once each: the event-driven path (a push, a turn end, a
     * new link). A pull request checked within `minAgeMs` or in rate-limit backoff is skipped; answers how many polled.
     */
    readonly refresh: (input: { readonly sessionIds: readonly string[]; readonly minAgeMs: number }) => Effect.Effect<number, PullRequestMonitorError>
  }
>()('@dshfiles/pull-requests/PullRequestMonitor') {
  static readonly layer = Layer.effect(
    PullRequestMonitor,
    Effect.gen(function* () {
      const store = yield* PullRequestStore
      const forge = yield* ForgePullRequests
      const hostApis = yield* HostApis
      const threadActions = hostApis.client(threadActionsApi)
      const autoSettle = hostApis.client(threadSidebarAutoSettleApi)

      const resolveLinkInput = Effect.fn('pull-requests resolve link')(function* (input: PullRequestLinkInput, caller: ApiCaller) {
        const sessionId = yield* sessionFor(input.sessionId, caller)
        if ('url' in input) {
          const parsed = parsePullRequestUrl(input.url)
          if (parsed === undefined)
            return yield* new PullRequestLocatorInvalid({
              reason:
                'Use a GitHub pull-request URL (https://github.com/<owner>/<repo>/pull/<n>) or a GitLab merge-request URL (https://<host>/<group>/<project>/-/merge_requests/<n>).',
            })
          return recordFor({
            sessionId,
            ...parsed,
            cwd: input.cwd ?? cwdForCaller(caller),
            watching: false,
          })
        }

        const info = yield* forge.repositoryInfo({ cwd: input.cwd })
        const target = forgeTargetOf(info.repo) ?? { kind: info.kind, host: info.host, project: info.project }
        return recordFor({
          sessionId,
          repo: info.repo,
          number: input.number,
          url: pullRequestUrlOf(target, input.number),
          cwd: input.cwd,
          watching: false,
        })
      })

      const resolveTarget = Effect.fn('pull-requests resolve target')(function* (input: PullRequestTargetInput, caller: ApiCaller) {
        const sessionId = yield* sessionFor(input.sessionId, caller)
        if ('url' in input) {
          const parsed = parsePullRequestUrl(input.url)
          if (parsed === undefined)
            return yield* new PullRequestLocatorInvalid({
              reason:
                'Use a GitHub pull-request URL (https://github.com/<owner>/<repo>/pull/<n>) or a GitLab merge-request URL (https://<host>/<group>/<project>/-/merge_requests/<n>).',
            })
          return { sessionId, repo: parsed.repo, number: parsed.number, id: linkId({ sessionId, repo: parsed.repo, number: parsed.number }) }
        }
        return { sessionId, repo: input.repo, number: input.number, id: linkId({ sessionId, repo: input.repo, number: input.number }) }
      })

      const promptThread = Effect.fn('pull-requests thread prompt')(function* (
        link: PullRequestRecord,
        snapshot: PullRequestSnapshot,
        transitions: readonly PullRequestTransition[],
      ) {
        const served = yield* hostApis.isServed(threadActionsApi)
        if (!served) {
          yield* Effect.logWarning('pull-requests: thread-sidebar is not loaded; the update stays in the link state but no thread message was queued', {
            sessionId: link.sessionId,
            repo: link.repo,
            number: link.number,
          })
          return
        }
        yield* threadActions
          .prompt({ sessionId: link.sessionId, text: transitionMessage({ link, snapshot, transitions }), mode: 'queue' })
          .pipe(
            Effect.catch(() =>
              Effect.logWarning('pull-requests: could not queue a thread update', { sessionId: link.sessionId, repo: link.repo, number: link.number }),
            ),
          )
      })

      const settleThread = Effect.fn('pull-requests thread settle')(function* (link: PullRequestRecord, state: 'MERGED' | 'CLOSED') {
        const served = yield* hostApis.isServed(threadSidebarAutoSettleApi)
        if (!served) {
          yield* Effect.logWarning('pull-requests: thread-sidebar is not loaded; the terminal pull-request state was stored but the thread was not settled', {
            sessionId: link.sessionId,
            repo: link.repo,
            number: link.number,
          })
          return
        }
        const reason = `pull request #${String(link.number)} ${state === 'MERGED' ? 'merged' : 'closed'}`
        yield* autoSettle.requestSettle({ sessionIds: [link.sessionId], reason, source: SETTLE_SOURCE }).pipe(
          Effect.catch(() =>
            Effect.logWarning('pull-requests: could not ask thread-sidebar to settle the thread', {
              sessionId: link.sessionId,
              repo: link.repo,
              number: link.number,
            }),
          ),
        )
      })

      const watchersOf = (target: { readonly repo: string; readonly number: number }) =>
        Effect.map(Effect.all([store.watched, store.owned]), ([links, owned]) => ({
          links: links.filter(record => samePullRequest(record, target)),
          owned: owned.filter(record => record.watching && samePullRequest(record, target)),
        }))

      const pollPullRequest = Effect.fn('pull request poll')(function* (input: { readonly repo: string; readonly number: number; readonly force: boolean }) {
        const now = yield* Clock.currentTimeMillis
        const initial = yield* watchersOf(input)
        const initialWatchers = [...initial.links, ...initial.owned]
        if (initialWatchers.length === 0) return
        const inBackoff = initialWatchers.every(record => {
          const status = PullRequestWatcher.statusOf(record, now)
          return status.kind === 'backoff'
        })
        if (!input.force && inBackoff) return

        const firstWatcher = initialWatchers.find(record => record.cwd.length > 0) ?? initialWatchers[0]
        if (firstWatcher === undefined) return
        const result = yield* capturePullRequestResult(forge.pullRequest({ repo: firstWatcher.repo, number: firstWatcher.number, cwd: firstWatcher.cwd }))
        if (result.kind === 'failure') {
          const rateLimited = (result.error._tag === 'GhCommandFailed' || result.error._tag === 'GlabCommandFailed') && result.error.rateLimited
          const errorTag = result.error._tag === 'GhResponseInvalid' || result.error._tag === 'GlabResponseInvalid' ? 'invalid-response' : 'gh-command-failed'
          const current = yield* watchersOf(firstWatcher)
          const count = rateLimited ? Math.max(...[...current.links, ...current.owned].map(record => record.consecutiveRateLimits), 0) + 1 : 0
          const retryAfterAt = now + backoffDelay(count)
          const outcome = rateLimited ? ({ kind: 'rate-limited', now, retryAfterAt, count } as const) : ({ kind: 'failed', now, error: errorTag } as const)
          for (const watcher of current.links) yield* store.updateIfWatching(watcher.id, record => PullRequestWatcher.afterPoll(record, outcome))
          for (const watcher of current.owned) yield* store.updateOwnedIfWatching(watcher.id, record => PullRequestWatcher.afterPoll(record, outcome))
          if (rateLimited) {
            yield* Effect.logWarning('pull-requests: GitHub rate limit detected; watcher backoff extended', {
              repo: firstWatcher.repo,
              number: firstWatcher.number,
              consecutiveRateLimits: count,
              retryAfterAt,
            })
          }
          return
        }

        const snapshot = summarizePullRequest(result.value)
        const current = yield* watchersOf(firstWatcher)
        for (const watcher of current.links) {
          const transitions = transitionPullRequest(watcher.lastKnownState ?? undefined, snapshot)
          const updated = yield* store.updateIfWatching(watcher.id, record => PullRequestWatcher.afterPoll(record, { kind: 'ok', snapshot, now }))
          if (updated === undefined) continue
          if (transitions.length > 0) yield* promptThread(updated, snapshot, transitions)
          if (snapshot.state === 'MERGED' || snapshot.state === 'CLOSED') yield* settleThread(updated, snapshot.state)
        }
        for (const watcher of current.owned)
          yield* store.updateOwnedIfWatching(watcher.id, record => PullRequestWatcher.afterPoll(record, { kind: 'ok', snapshot, now }))
      })

      const groupsOf = <Watch extends Pick<PullRequestRecord, 'repo' | 'number'>>(watchers: readonly Watch[]): readonly (readonly Watch[])[] => {
        const groups = new Map<string, Watch[]>()
        for (const watcher of watchers) {
          const key = pullRequestKey(watcher)
          const group = groups.get(key)
          if (group === undefined) groups.set(key, [watcher])
          else group.push(watcher)
        }
        return [...groups.values()]
      }

      const pollTargets = (targets: readonly { readonly repo: string; readonly number: number }[]) =>
        Effect.forEach(
          targets,
          target =>
            pollPullRequest({ ...target, force: false }).pipe(
              Effect.catchCause(() =>
                Effect.logWarning('pull-requests: pull request poll failed; the next poll will continue', {
                  repo: target.repo,
                  number: target.number,
                }),
              ),
            ),
          { concurrency: POLL_CONCURRENCY, discard: true },
        )

      const refresh = Effect.fn('pull-requests refresh')(function* (input: { readonly sessionIds: readonly string[]; readonly minAgeMs: number }) {
        const sessionIds = new Set(input.sessionIds)
        const now = yield* Clock.currentTimeMillis
        const watched = yield* store.watched
        const linked = new Set(watched.filter(record => sessionIds.has(record.sessionId)).map(pullRequestKey))
        const targets = groupsOf(watched.filter(record => linked.has(pullRequestKey(record)))).flatMap(group => {
          const first = group[0]
          if (first === undefined) return []
          const fresh = group.some(record => record.lastCheckedAt !== null && now - record.lastCheckedAt < input.minAgeMs)
          return fresh ? [] : [{ repo: first.repo, number: first.number }]
        })
        yield* pollTargets(targets)
        return targets.length
      })

      const pollAll = Effect.fn('pull-requests poll all')(function* () {
        const owned = (yield* store.owned).filter(record => record.watching)
        const targets = groupsOf([...(yield* store.watched), ...owned]).flatMap(group => {
          const first = group[0]
          return first === undefined ? [] : [{ repo: first.repo, number: first.number }]
        })
        yield* pollTargets(targets)
      })

      const link = Effect.fn('pull-requests link')(function* (input: PullRequestLinkInput, caller: ApiCaller) {
        const linked = yield* store.upsert(yield* resolveLinkInput(input, caller))
        // A new link to a pull request another thread watches refreshes it now instead of at the next sweep.
        yield* refresh({ sessionIds: [linked.sessionId], minAgeMs: EVENT_REFRESH_MIN_AGE_MS }).pipe(Effect.ignore)
        return linked
      })

      const unlink = Effect.fn('pull-requests unlink')(function* (input: PullRequestTargetInput, caller: ApiCaller) {
        const target = yield* resolveTarget(input, caller)
        const removed = yield* store.remove(target.id)
        return { sessionId: target.sessionId, repo: target.repo, number: target.number, removed }
      })

      const list = Effect.fn('pull-requests list')(function* (
        input: { readonly sessionId?: string | undefined; readonly all?: boolean | undefined },
        caller: ApiCaller,
      ) {
        if (input.all === true) {
          const links = yield* store.list()
          return { links, total: links.length, all: true }
        }
        const sessionId = yield* sessionFor(input.sessionId, caller)
        const links = yield* store.list(sessionId)
        return { links, total: links.length, all: false }
      })

      const watch = Effect.fn('pull-requests watch')(function* (input: PullRequestLinkInput, caller: ApiCaller) {
        const record = yield* resolveLinkInput(input, caller)
        const watching = yield* store.upsert({ ...record, watching: true })
        yield* pollPullRequest({ repo: watching.repo, number: watching.number, force: true })
        return (yield* store.get(watching.id)) ?? watching
      })

      const unwatch = Effect.fn('pull-requests unwatch')(function* (input: PullRequestTargetInput, caller: ApiCaller) {
        const target = yield* resolveTarget(input, caller)
        const record = yield* store.setWatching(target.id, false)
        if (record === undefined) return yield* new PullRequestLinkNotFound({ sessionId: target.sessionId, repo: target.repo, number: target.number })
        return record
      })

      const locatorError = new PullRequestLocatorInvalid({
        reason:
          'Use a GitHub pull-request URL (https://github.com/<owner>/<repo>/pull/<n>) or a GitLab merge-request URL (https://<host>/<group>/<project>/-/merge_requests/<n>).',
      })

      const watchFor = Effect.fn('pull-requests watch for owner')(function* (input: {
        readonly owner: WatchOwner
        readonly url: string
        readonly cwd?: string | undefined
      }) {
        const parsed = parsePullRequestUrl(input.url)
        if (parsed === undefined) return yield* locatorError
        const id = ownedWatchId({ owner: input.owner, ...parsed })
        const existing = (yield* store.owned).find(record => record.id === id)
        const saved = yield* store.upsertOwned({
          id,
          owner: input.owner,
          ...parsed,
          cwd: input.cwd ?? '',
          watching: true,
          lastKnownState: null,
          lastCheckedAt: null,
          retryAfterAt: null,
          consecutiveRateLimits: 0,
          lastError: null,
        })
        if (existing !== undefined || !saved.watching) return saved
        const now = yield* Clock.currentTimeMillis
        // A backfill of many items must not keep calling gh through a rate limit: the sweep picks them up after it.
        const limited = [...(yield* store.watched), ...(yield* store.owned)].some(record => record.retryAfterAt !== null && record.retryAfterAt > now)
        if (!limited) yield* pollPullRequest({ repo: saved.repo, number: saved.number, force: false }).pipe(Effect.ignore)
        return (yield* store.owned).find(record => record.id === id) ?? saved
      })

      const unwatchFor = Effect.fn('pull-requests unwatch for owner')(function* (input: { readonly owner: WatchOwner; readonly url?: string | undefined }) {
        const parsed = input.url === undefined ? undefined : parsePullRequestUrl(input.url)
        if (input.url !== undefined && parsed === undefined) return yield* locatorError
        const ids = (yield* store.owned)
          .filter(
            record => record.owner.kind === input.owner.kind && record.owner.id === input.owner.id && (parsed === undefined || samePullRequest(record, parsed)),
          )
          .map(record => record.id)
        return yield* store.removeOwned(ids)
      })

      const ownedWatches = Effect.fn('pull-requests owned watches')(function* (input: { readonly kind: WatchOwner['kind'] }) {
        return (yield* store.owned).filter(record => record.owner.kind === input.kind)
      })

      return PullRequestMonitor.of({ link, unlink, list, watch, unwatch, pollAll: pollAll(), refresh, watchFor, unwatchFor, ownedWatches })
    }),
  )
}
