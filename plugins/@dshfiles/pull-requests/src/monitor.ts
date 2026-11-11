import type { ApiCaller } from '@dshfiles/dshx/api'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { StorageDomainReadFailed, StorageDomainWriteFailed } from '@dshfiles/dshx/effect/storage-domain'
import { threadActionsApi } from '@dshfiles/thread-sidebar/thread-actions-api'
import { threadSidebarAutoSettleApi } from '@dshfiles/thread-sidebar/auto-settle-api'
import { Clock, Context, Effect, Layer, Ref, Schema } from 'effect'
import { GhCommandFailed, GhResponseInvalid, type PullRequestRead } from './github-cli.js'
import { GlabCommandFailed, GlabResponseInvalid } from './gitlab-cli.js'
import { ForgeModel } from './forge.js'
import { ForgePullRequests, UnsupportedRepository } from './forge-port.js'
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
  type OwnedWatchRecord,
  type OwnedWatchView,
  type WatchOwner,
} from './pull-request-model.js'
import { PullRequestStore } from './store.js'

const POLL_INTERVAL_MS = 2 * 60_000
const MAX_BACKOFF_MS = 60 * 60_000
/**
 * GitHub GraphQL points the watcher leaves for everything else (agents' own `gh` calls share the user's 5,000 an hour):
 * once a read reports fewer remaining, GitHub reads wait until the budget resets. The Host sets it from settings.
 */
export const GitHubPointsFloor = Context.Reference<number>('@dshfiles/pull-requests/GitHubPointsFloor', { defaultValue: () => 500 })
const SETTLE_SOURCE = '@dshfiles/pull-requests'
/** An event-driven refresh skips a pull request checked this recently: a burst of thread events costs one `gh` call. */
export const EVENT_REFRESH_MIN_AGE_MS = 20_000

type Target = Pick<PullRequestRecord, 'repo' | 'number'>
interface Watchers {
  readonly links: PullRequestRecord[]
  readonly owned: OwnedWatchRecord[]
}

const pullRequestKey = (record: Target): string => `${record.repo.toLowerCase()}#${String(record.number)}`

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

const sessionFor = (provided: string | undefined, caller: ApiCaller): Effect.Effect<string, PullRequestSessionRequired> => {
  if (provided !== undefined) return Effect.succeed(provided)
  if (caller.kind === 'agent' && caller.sessionId !== undefined) return Effect.succeed(caller.sessionId)
  return Effect.fail(new PullRequestSessionRequired({ reason: 'Pass a session id when the call is not made from a thread.' }))
}

const cwdForCaller = (caller: ApiCaller): string => (caller.kind === 'agent' ? (caller.cwd ?? '') : '')

const parsePullRequestUrl = (url: string): { readonly repo: string; readonly number: number; readonly url: string } | undefined => {
  const target = ForgeModel.parsePullRequestUrl(url)
  if (target === undefined) return undefined
  return { repo: ForgeModel.repositoryKeyOf(target), number: target.number, url: target.url }
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

const ownedWatchViewOf = (record: OwnedWatchRecord): OwnedWatchView => ({
  owner: record.owner,
  repo: record.repo,
  number: record.number,
  url: record.url,
  watching: record.watching,
  lastKnownState: record.lastKnownState,
  lastCheckedAt: record.lastCheckedAt,
  lastError: record.lastError,
})

/** Who a monitor call acts for, and the owned-watch view the API returns. */
export class PullRequestMonitorModel {
  static readonly sessionFor = sessionFor
  static readonly cwdForCaller = cwdForCaller
  static readonly ownedWatchViewOf = ownedWatchViewOf
}

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
        const target = ForgeModel.targetOf(info.repo) ?? { kind: info.kind, host: info.host, project: info.project }
        return recordFor({
          sessionId,
          repo: info.repo,
          number: input.number,
          url: ForgeModel.pullRequestUrlOf(target, input.number),
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

      /** Answers false only when thread-sidebar is loaded but refused the request: the thread still needs settling. */
      const settleThread = Effect.fn('pull-requests thread settle')(function* (link: PullRequestRecord, state: 'MERGED' | 'CLOSED') {
        const served = yield* hostApis.isServed(threadSidebarAutoSettleApi)
        if (!served) {
          yield* Effect.logWarning('pull-requests: thread-sidebar is not loaded; the terminal pull-request state was stored but the thread was not settled', {
            sessionId: link.sessionId,
            repo: link.repo,
            number: link.number,
          })
          return true
        }
        const reason = `pull request #${String(link.number)} ${state === 'MERGED' ? 'merged' : 'closed'}`
        return yield* autoSettle.requestSettle({ sessionIds: [link.sessionId], reason, source: SETTLE_SOURCE }).pipe(
          Effect.as(true),
          Effect.catch(() =>
            Effect.as(
              Effect.logWarning('pull-requests: could not ask thread-sidebar to settle the thread; the next poll retries', {
                sessionId: link.sessionId,
                repo: link.repo,
                number: link.number,
              }),
              false,
            ),
          ),
        )
      })

      /** Until when GitHub reads wait: the budget's reset after a low read, or the backoff after a rate limit. */
      const githubPausedUntil = yield* Ref.make(0)

      const watchersByKey = Effect.map(Effect.all([store.watched, store.owned]), ([links, owned]) => {
        const byKey = new Map<string, Watchers>()
        const groupOf = (record: Target): Watchers => {
          const key = pullRequestKey(record)
          const found = byKey.get(key)
          if (found !== undefined) return found
          const created: Watchers = { links: [], owned: [] }
          byKey.set(key, created)
          return created
        }
        for (const record of links) groupOf(record).links.push(record)
        for (const record of owned) if (record.watching) groupOf(record).owned.push(record)
        return byKey
      })

      const isGitHub = (repo: string): boolean => ForgeModel.targetOf(repo)?.kind === 'github'

      const snapshotOf = (read: Extract<PullRequestRead, { readonly kind: 'read' }>): PullRequestSnapshot =>
        read.fingerprint === null ? summarizePullRequest(read.view) : { ...summarizePullRequest(read.view), fingerprint: read.fingerprint }

      /** Store one pull request's read on every watch of it; answers the retry time when GitHub rate-limited it. */
      const applyRead = Effect.fn('pull request poll')(function* (input: {
        readonly read: PullRequestRead
        readonly watchers: Watchers | undefined
        readonly now: number
      }) {
        const links = input.watchers?.links ?? []
        const owned = input.watchers?.owned ?? []
        const read = input.read
        const now = input.now
        if (read.kind === 'deferred') return undefined
        if (read.kind === 'rate-limited' || read.kind === 'failed') {
          const count = read.kind === 'rate-limited' ? Math.max(...[...links, ...owned].map(record => record.consecutiveRateLimits), 0) + 1 : 0
          const retryAfterAt = now + backoffDelay(count)
          const outcome =
            read.kind === 'rate-limited' ? ({ kind: 'rate-limited', now, retryAfterAt, count } as const) : ({ kind: 'failed', now, error: read.error } as const)
          for (const watcher of links) yield* store.updateIfWatching(watcher.id, record => PullRequestWatcher.afterPoll(record, outcome))
          for (const watcher of owned) yield* store.updateOwnedIfWatching(watcher.id, record => PullRequestWatcher.afterPoll(record, outcome))
          return read.kind === 'rate-limited' ? retryAfterAt : undefined
        }
        const fresh = read.kind === 'read' ? snapshotOf(read) : undefined
        for (const watcher of links) {
          const snapshot = fresh ?? watcher.lastKnownState
          if (snapshot === null) continue
          const transitions = transitionPullRequest(watcher.lastKnownState ?? undefined, snapshot)
          const updated = yield* store.updateIfWatching(watcher.id, record => PullRequestWatcher.afterPoll(record, { kind: 'ok', snapshot, now }))
          if (updated === undefined) continue
          if (transitions.length > 0) yield* promptThread(updated, snapshot, transitions)
          if (snapshot.state === 'OPEN') continue
          // A terminal pull request stops being polled, unless its thread still has to be settled.
          const settled = yield* settleThread(updated, snapshot.state)
          if (!settled) yield* store.setWatching(updated.id, true)
        }
        for (const watcher of owned) {
          const snapshot = fresh ?? watcher.lastKnownState
          if (snapshot !== null) yield* store.updateOwnedIfWatching(watcher.id, record => PullRequestWatcher.afterPoll(record, { kind: 'ok', snapshot, now }))
        }
        return undefined
      })

      /**
       * Read these pull requests in one batched forge call and store each outcome. GitHub reads are skipped while the
       * budget is paused, and a pull request whose every watch is in backoff waits, unless `force` (an explicit watch).
       */
      const pollTargets = Effect.fn('pull-requests poll targets')(function* (input: { readonly targets: readonly Target[]; readonly force: boolean }) {
        const now = yield* Clock.currentTimeMillis
        const floor = yield* GitHubPointsFloor
        const paused = (yield* Ref.get(githubPausedUntil)) > now
        const before = yield* watchersByKey
        const unique = [...new Map(input.targets.map(target => [pullRequestKey(target), target])).values()]
        const reads = unique.flatMap(target => {
          const group = before.get(pullRequestKey(target))
          const watchers = group === undefined ? [] : [...group.links, ...group.owned]
          const first = watchers.find(record => record.cwd.length > 0) ?? watchers[0]
          if (first === undefined) return []
          if (!input.force && watchers.every(record => PullRequestWatcher.statusOf(record, now).kind === 'backoff')) return []
          if (!input.force && paused && isGitHub(first.repo)) return []
          const fingerprints = new Set(watchers.map(record => record.lastKnownState?.fingerprint ?? null))
          const known = fingerprints.size === 1 ? (first.lastKnownState?.fingerprint ?? null) : null
          return [{ repo: first.repo, number: first.number, cwd: first.cwd, known }]
        })
        if (reads.length === 0) return 0
        const result = yield* forge.pullRequests({ targets: reads, minRemaining: floor })
        const budget = result.rateLimit
        if (budget !== null && budget.remaining < floor) {
          yield* Ref.update(githubPausedUntil, until => Math.max(until, budget.resetAt))
          yield* Effect.logWarning('pull-requests: GitHub API budget is low; GitHub reads wait until it resets', {
            remaining: budget.remaining,
            floor,
            resetAt: budget.resetAt,
          })
        }
        const after = yield* watchersByKey
        const retries = yield* Effect.forEach(reads, (target, index) =>
          applyRead({ read: result.reads[index] ?? { kind: 'deferred' }, watchers: after.get(pullRequestKey(target)), now }).pipe(
            Effect.catchCause(() =>
              Effect.as(
                Effect.logWarning('pull-requests: storing a pull request poll failed; the next poll will retry', { repo: target.repo, number: target.number }),
                undefined,
              ),
            ),
          ),
        )
        const retryAfterAt = Math.max(0, ...retries.filter((retry): retry is number => retry !== undefined))
        if (result.rateLimited) {
          yield* Ref.update(githubPausedUntil, until => Math.max(until, retryAfterAt))
          yield* Effect.logWarning('pull-requests: GitHub rate limit detected; watcher backoff extended', { retryAfterAt })
        }
        return reads.length
      })

      const targetsOf = (records: readonly Target[]): readonly Target[] => records.map(record => ({ repo: record.repo, number: record.number }))

      const refresh = Effect.fn('pull-requests refresh')(function* (input: { readonly sessionIds: readonly string[]; readonly minAgeMs: number }) {
        const sessionIds = new Set(input.sessionIds)
        const now = yield* Clock.currentTimeMillis
        const watched = yield* store.watched
        const linked = new Set(watched.filter(record => sessionIds.has(record.sessionId)).map(pullRequestKey))
        const fresh = new Set(watched.filter(record => record.lastCheckedAt !== null && now - record.lastCheckedAt < input.minAgeMs).map(pullRequestKey))
        const targets = targetsOf(watched.filter(record => linked.has(pullRequestKey(record)) && !fresh.has(pullRequestKey(record))))
        return yield* pollTargets({ targets, force: false })
      })

      const pollAll = Effect.fn('pull-requests poll all')(function* () {
        const owned = (yield* store.owned).filter(record => record.watching)
        yield* pollTargets({ targets: targetsOf([...(yield* store.watched), ...owned]), force: false })
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
        yield* pollTargets({ targets: [{ repo: watching.repo, number: watching.number }], force: true })
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
        if (!limited) yield* pollTargets({ targets: [{ repo: saved.repo, number: saved.number }], force: false }).pipe(Effect.ignore)
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
