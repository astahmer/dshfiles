import type { ApiCaller } from '@dshfiles/dshx/api'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { StorageDomainReadFailed, StorageDomainWriteFailed } from '@dshfiles/dshx/effect/storage-domain'
import { threadActionsApi } from '@dshfiles/thread-sidebar/thread-actions-api'
import { threadSidebarAutoSettleApi } from '@dshfiles/thread-sidebar/auto-settle-api'
import { Clock, Context, Effect, Layer, Schema } from 'effect'
import { GhCommandFailed, GhResponseInvalid, GitHubCli } from './github-cli.js'
import {
  summarizePullRequest,
  transitionPullRequest,
  type PullRequestEvent,
  type PullRequestLinkInput,
  type PullRequestRecord,
  type PullRequestSnapshot,
  type PullRequestTargetInput,
  type PullRequestTransition,
  type GitHubPullRequestView,
} from './pull-request-model.js'
import { PullRequestStore } from './store.js'

type PullRequestPollResult =
  | { readonly kind: 'success'; readonly value: GitHubPullRequestView }
  | { readonly kind: 'failure'; readonly error: GhCommandFailed | GhResponseInvalid }

const capturePullRequestResult = (effect: Effect.Effect<GitHubPullRequestView, GhCommandFailed | GhResponseInvalid>) =>
  effect.pipe(
    Effect.map((value): PullRequestPollResult => ({ kind: 'success', value })),
    Effect.catch((error): Effect.Effect<PullRequestPollResult> => Effect.succeed({ kind: 'failure', error })),
  )

const POLL_INTERVAL_MS = 2 * 60_000
const MAX_BACKOFF_MS = 60 * 60_000
const SETTLE_SOURCE = '@dshfiles/pull-requests'

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
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/u.exec(url)
  const owner = match?.[1]
  const repository = match?.[2]
  const numberText = match?.[3]
  if (owner === undefined || repository === undefined || numberText === undefined) return undefined
  const number = Number(numberText)
  return { repo: `${owner}/${repository}`, number, url: `https://github.com/${owner}/${repository}/pull/${String(number)}` }
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
    readonly pollAll: Effect.Effect<void, PullRequestMonitorError>
  }
>()('@dshfiles/pull-requests/PullRequestMonitor') {
  static readonly layer = Layer.effect(
    PullRequestMonitor,
    Effect.gen(function* () {
      const store = yield* PullRequestStore
      const github = yield* GitHubCli
      const hostApis = yield* HostApis
      const threadActions = hostApis.client(threadActionsApi)
      const autoSettle = hostApis.client(threadSidebarAutoSettleApi)

      const resolveLinkInput = Effect.fn('pull-requests resolve link')(function* (input: PullRequestLinkInput, caller: ApiCaller) {
        const sessionId = yield* sessionFor(input.sessionId, caller)
        if ('url' in input) {
          const parsed = parsePullRequestUrl(input.url)
          if (parsed === undefined) return yield* new PullRequestLocatorInvalid({ reason: 'Use a GitHub.com pull-request URL.' })
          return recordFor({
            sessionId,
            ...parsed,
            cwd: input.cwd ?? cwdForCaller(caller),
            watching: false,
          })
        }

        const repo = yield* github.repositoryName({ cwd: input.cwd })
        return recordFor({
          sessionId,
          repo,
          number: input.number,
          url: `https://github.com/${repo}/pull/${String(input.number)}`,
          cwd: input.cwd,
          watching: false,
        })
      })

      const resolveTarget = Effect.fn('pull-requests resolve target')(function* (input: PullRequestTargetInput, caller: ApiCaller) {
        const sessionId = yield* sessionFor(input.sessionId, caller)
        if ('url' in input) {
          const parsed = parsePullRequestUrl(input.url)
          if (parsed === undefined) return yield* new PullRequestLocatorInvalid({ reason: 'Use a GitHub.com pull-request URL.' })
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

      const pollPullRequest = Effect.fn('pull request poll')(function* (input: { readonly repo: string; readonly number: number; readonly force: boolean }) {
        const now = yield* Clock.currentTimeMillis
        const beforePoll = yield* store.watched
        const initialWatchers = beforePoll.filter(record => samePullRequest(record, { repo: input.repo, number: input.number }))
        if (initialWatchers.length === 0) return
        if (!input.force && initialWatchers.every(record => record.retryAfterAt !== null && record.retryAfterAt > now)) return

        const firstWatcher = initialWatchers[0]
        if (firstWatcher === undefined) return
        const result = yield* capturePullRequestResult(github.pullRequest({ repo: firstWatcher.repo, number: firstWatcher.number, cwd: firstWatcher.cwd }))
        if (result.kind === 'failure') {
          const rateLimited = result.error._tag === 'GhCommandFailed' && result.error.rateLimited
          const errorTag = result.error._tag === 'GhResponseInvalid' ? 'invalid-response' : 'gh-command-failed'
          const currentWatchers = (yield* store.watched).filter(record => samePullRequest(record, firstWatcher))
          const count = rateLimited ? Math.max(...currentWatchers.map(record => record.consecutiveRateLimits), 0) + 1 : 0
          const retryAfterAt = rateLimited ? now + backoffDelay(count) : null
          for (const watcher of currentWatchers) {
            yield* store.updateIfWatching(watcher.id, current => ({
              ...current,
              lastCheckedAt: now,
              lastError: errorTag,
              retryAfterAt,
              consecutiveRateLimits: count,
            }))
          }
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
        const currentWatchers = (yield* store.watched).filter(record => samePullRequest(record, firstWatcher))
        for (const watcher of currentWatchers) {
          const transitions = transitionPullRequest(watcher.lastKnownState ?? undefined, snapshot)
          const terminal = snapshot.state === 'MERGED' || snapshot.state === 'CLOSED'
          const updated = yield* store.updateIfWatching(watcher.id, current => ({
            ...current,
            watching: terminal ? false : true,
            lastKnownState: snapshot,
            lastCheckedAt: now,
            retryAfterAt: null,
            consecutiveRateLimits: 0,
            lastError: null,
          }))
          if (updated === undefined) continue
          if (transitions.length > 0) yield* promptThread(updated, snapshot, transitions)
          if (snapshot.state === 'MERGED' || snapshot.state === 'CLOSED') yield* settleThread(updated, snapshot.state)
        }
      })

      const pollAll = Effect.fn('pull-requests poll all')(function* () {
        const watchers = yield* store.watched
        const groups = new Map<string, PullRequestRecord[]>()
        for (const watcher of watchers) {
          const key = `${watcher.repo.toLowerCase()}#${String(watcher.number)}`
          const group = groups.get(key)
          if (group === undefined) groups.set(key, [watcher])
          else group.push(watcher)
        }
        for (const group of groups.values()) {
          const first = group[0]
          if (first === undefined) continue
          yield* pollPullRequest({ repo: first.repo, number: first.number, force: false }).pipe(
            Effect.catchCause(() =>
              Effect.logWarning('pull-requests: pull request poll failed; the next poll will continue', {
                repo: first.repo,
                number: first.number,
              }),
            ),
          )
        }
      })

      const link = Effect.fn('pull-requests link')(function* (input: PullRequestLinkInput, caller: ApiCaller) {
        return yield* store.upsert(yield* resolveLinkInput(input, caller))
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

      return PullRequestMonitor.of({ link, unlink, list, watch, unwatch, pollAll: pollAll() })
    }),
  )
}
