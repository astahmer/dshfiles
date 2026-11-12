import * as Schema from 'effect/Schema'
import { repositorySchema } from './forge.js'

export const forgeSearchItemSchema = Schema.Struct({
  number: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  title: Schema.String,
  state: Schema.String,
  url: Schema.String.check(Schema.isPattern(/^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/[1-9]\d*$/u)),
  isPullRequest: Schema.Boolean,
})
export type ForgeSearchItem = typeof forgeSearchItemSchema.Type

/**
 * Why a `#` search found nothing to list (b:ysaj): the GitHub CLI is missing, or it is signed out. Any other failure
 * (a folder with no GitHub remote) is not a forge, so the picker stays empty instead of offering a recovery.
 */
export const forgeSearchUnavailableSchema = Schema.Struct({
  reason: Schema.Literals(['gh-missing', 'signed-out']),
  message: Schema.String,
})
export type ForgeSearchUnavailable = typeof forgeSearchUnavailableSchema.Type

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const cwdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))
const pullRequestNumberSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))

/** A GitHub pull-request or GitLab merge-request URL on an https forge host. */
export const pullRequestUrlSchema = Schema.String.check(
  Schema.isPattern(/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\/(?:pull|-\/merge_requests)\/[1-9]\d*\/?$/u),
)
export const githubPullRequestUrlSchema = pullRequestUrlSchema

const actorSchema = Schema.NullOr(Schema.Struct({ login: Schema.String }))
const githubTimestampSchema = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u))

const checkRunSchema = Schema.Struct({
  __typename: Schema.optional(Schema.Literal('CheckRun')),
  name: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
})

const statusContextSchema = Schema.Struct({
  __typename: Schema.optional(Schema.Literal('StatusContext')),
  context: Schema.String,
  state: Schema.String,
})

export const checkRollupSchema = Schema.Union([checkRunSchema, statusContextSchema])

export const commentSchema = Schema.Struct({
  author: actorSchema,
  createdAt: githubTimestampSchema,
})

export const reviewSchema = Schema.Struct({
  author: actorSchema,
  state: Schema.String,
  submittedAt: Schema.NullOr(githubTimestampSchema),
})

export const githubPullRequestViewSchema = Schema.Struct({
  state: Schema.Literals(['OPEN', 'CLOSED', 'MERGED']),
  mergeable: Schema.Literals(['MERGEABLE', 'CONFLICTING', 'UNKNOWN']),
  mergeStateStatus: Schema.Literals(['UNKNOWN', 'BEHIND', 'BLOCKED', 'CLEAN', 'DIRTY', 'DRAFT', 'HAS_HOOKS', 'UNSTABLE']),
  reviewDecision: Schema.NullOr(Schema.Literals(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'])),
  statusCheckRollup: Schema.NullOr(Schema.Array(checkRollupSchema)),
  comments: Schema.Array(commentSchema),
  reviews: Schema.Array(reviewSchema),
  body: Schema.String,
  /** GitHub's total when the read returned only the latest comments; absent means `comments` is the whole list. */
  commentsCount: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  reviewsCount: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
})

export type GitHubPullRequestView = Schema.Schema.Type<typeof githubPullRequestViewSchema>

const supportedCheckStatuses = [
  'SUCCESS',
  'FAILURE',
  'ERROR',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'NEUTRAL',
  'CANCELLED',
  'STALE',
  'SKIPPED',
  'PENDING',
  'QUEUED',
  'IN_PROGRESS',
  'UNKNOWN',
] as const

type SupportedCheckStatus = (typeof supportedCheckStatuses)[number]

export const pullRequestCheckSchema = Schema.Struct({ status: Schema.Literals(supportedCheckStatuses) })

export const pullRequestEventSchema = Schema.Struct({ at: githubTimestampSchema, author: Schema.NullOr(Schema.String) })

/** How much of a pull request's description a stored snapshot keeps: closing references sit at its top. */
export const MAX_SNAPSHOT_BODY_CHARS = 16_384

export const pullRequestSnapshotSchema = Schema.Struct({
  state: Schema.Literals(['OPEN', 'CLOSED', 'MERGED']),
  mergeable: Schema.Literals(['MERGEABLE', 'CONFLICTING', 'UNKNOWN']),
  mergeStateStatus: Schema.Literals(['UNKNOWN', 'BEHIND', 'BLOCKED', 'CLEAN', 'DIRTY', 'DRAFT', 'HAS_HOOKS', 'UNSTABLE']),
  reviewDecision: Schema.NullOr(Schema.Literals(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'])),
  checks: Schema.Array(pullRequestCheckSchema),
  commentsCount: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  latestComment: Schema.NullOr(pullRequestEventSchema),
  reviewsCount: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  latestReview: Schema.NullOr(pullRequestEventSchema),
  /** The description as polled, bounded; absent in records written before it was kept. */
  body: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(MAX_SNAPSHOT_BODY_CHARS))),
  /**
   * A digest of the fields a cheap GitHub read returns (state, update time, mergeability, head commit, check counts by
   * state). The same digest on the next read means nothing this snapshot holds changed, so the full read is skipped.
   */
  fingerprint: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(64))),
})

export type PullRequestSnapshot = Schema.Schema.Type<typeof pullRequestSnapshotSchema>

const lastErrorSchema = Schema.NullOr(Schema.Literals(['gh-command-failed', 'invalid-response']))

export const pullRequestRecordSchema = Schema.Struct({
  id: Schema.String,
  sessionId: sessionIdSchema,
  repo: repositorySchema,
  number: pullRequestNumberSchema,
  url: githubPullRequestUrlSchema,
  cwd: Schema.String.check(Schema.isMaxLength(2048)),
  watching: Schema.Boolean,
  lastKnownState: Schema.NullOr(pullRequestSnapshotSchema),
  lastCheckedAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  retryAfterAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  consecutiveRateLimits: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  lastError: lastErrorSchema,
})

export type PullRequestRecord = Schema.Schema.Type<typeof pullRequestRecordSchema>

export const pullRequestLinkViewSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  repo: repositorySchema,
  number: pullRequestNumberSchema,
  url: githubPullRequestUrlSchema,
  watching: Schema.Boolean,
  lastKnownState: Schema.NullOr(pullRequestSnapshotSchema),
  lastCheckedAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  lastError: lastErrorSchema,
})

export type PullRequestLinkView = Schema.Schema.Type<typeof pullRequestLinkViewSchema>

/**
 * Who besides a thread may own a watch. A backlog item watches the pull requests it links, so their state stays current
 * without a thread; the owner's id is its own key (the backlog item id), never a session id.
 */
const watchOwnerSchema = Schema.Struct({
  kind: Schema.Literal('backlog-item'),
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
})
export type WatchOwner = Schema.Schema.Type<typeof watchOwnerSchema>

/** A watch an owner other than a thread holds: polled with the thread links, but it never prompts or settles a thread. */
export const ownedWatchRecordSchema = Schema.Struct({
  id: Schema.String,
  owner: watchOwnerSchema,
  repo: repositorySchema,
  number: pullRequestNumberSchema,
  url: githubPullRequestUrlSchema,
  cwd: Schema.String.check(Schema.isMaxLength(2048)),
  watching: Schema.Boolean,
  lastKnownState: Schema.NullOr(pullRequestSnapshotSchema),
  lastCheckedAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  retryAfterAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  consecutiveRateLimits: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  lastError: lastErrorSchema,
})
export type OwnedWatchRecord = Schema.Schema.Type<typeof ownedWatchRecordSchema>

const ownedWatchViewSchema = Schema.Struct({
  owner: watchOwnerSchema,
  repo: repositorySchema,
  number: pullRequestNumberSchema,
  url: githubPullRequestUrlSchema,
  watching: Schema.Boolean,
  lastKnownState: Schema.NullOr(pullRequestSnapshotSchema),
  lastCheckedAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  lastError: lastErrorSchema,
})
export type OwnedWatchView = Schema.Schema.Type<typeof ownedWatchViewSchema>

export const ownedWatchInputSchema = Schema.Struct({ owner: watchOwnerSchema, url: githubPullRequestUrlSchema, cwd: Schema.optional(cwdSchema) })
export const ownedUnwatchInputSchema = Schema.Struct({ owner: watchOwnerSchema, url: Schema.optional(githubPullRequestUrlSchema) })
export const ownedWatchListInputSchema = Schema.Struct({ kind: Schema.Literal('backlog-item') })
export const ownedWatchMutationOutputSchema = Schema.Struct({ watch: ownedWatchViewSchema })
export const ownedUnwatchOutputSchema = Schema.Struct({ removed: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) })
export const ownedWatchListOutputSchema = Schema.Struct({ watches: Schema.Array(ownedWatchViewSchema) })

/** Issues one state read covers: one GraphQL call per batch of fifty. */
const MAX_ISSUE_STATE_URLS = 100

/** A GitHub issue URL. */
const githubIssueUrlSchema = Schema.String.check(Schema.isPattern(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*\/?$/u))

const issueStateSchema = Schema.Struct({
  url: Schema.String,
  state: Schema.Literals(['OPEN', 'CLOSED']),
  /** GitHub's close reason: COMPLETED, NOT_PLANNED, DUPLICATE or REOPENED; null while open or unknown. */
  stateReason: Schema.NullOr(Schema.String.check(Schema.isMaxLength(40))),
  checkedAt: Schema.Number.check(Schema.isFinite()),
})

export const issueStatesInputSchema = Schema.Struct({ urls: Schema.Array(githubIssueUrlSchema).check(Schema.isMaxLength(MAX_ISSUE_STATE_URLS)) })
export const issueStatesOutputSchema = Schema.Struct({
  issues: Schema.Array(issueStateSchema),
  /** URLs this read could not answer (a failed call, a deleted or transferred issue); retry them later. */
  failed: Schema.Array(Schema.String),
  /** GitHub rate-limited the read: back off before the next one. */
  rateLimited: Schema.Boolean,
})
export type IssueStatesOutput = Schema.Schema.Type<typeof issueStatesOutputSchema>

/** What one poll of a watched pull request came back with: the three outcomes the monitor can act on. */
export type WatcherPollOutcome =
  | { readonly kind: 'ok'; readonly snapshot: PullRequestSnapshot; readonly now: number }
  | { readonly kind: 'rate-limited'; readonly now: number; readonly retryAfterAt: number; readonly count: number }
  | { readonly kind: 'failed'; readonly now: number; readonly error: NonNullable<PullRequestRecord['lastError']> }

/** Where a watched pull request stands right now, read once from its stored record. */
export type WatcherStatus =
  | { readonly kind: 'unwatched' }
  | { readonly kind: 'watching' }
  | { readonly kind: 'backoff'; readonly until: number; readonly count: number }
  | { readonly kind: 'failed'; readonly error: NonNullable<PullRequestRecord['lastError']> }
  | { readonly kind: 'terminal'; readonly state: 'MERGED' | 'CLOSED' }

const terminalState = (record: Pick<PullRequestRecord, 'lastKnownState'>): 'MERGED' | 'CLOSED' | undefined => {
  const state = record.lastKnownState?.state
  return state === 'MERGED' || state === 'CLOSED' ? state : undefined
}

/**
 * A watcher is in backoff while its retry is ahead, failed after a poll that could not read GitHub, watching while it
 * polls on the regular interval, and terminal once its pull request merged or closed.
 */
export class PullRequestWatcher {
  static readonly statusOf = (
    record: Pick<PullRequestRecord, 'watching' | 'lastKnownState' | 'retryAfterAt' | 'consecutiveRateLimits' | 'lastError'>,
    now: number,
  ): WatcherStatus => {
    if (record.watching) {
      if (record.retryAfterAt !== null && record.retryAfterAt > now) return { kind: 'backoff', until: record.retryAfterAt, count: record.consecutiveRateLimits }
      if (record.lastError !== null) return { kind: 'failed', error: record.lastError }
      return { kind: 'watching' }
    }
    const state = terminalState(record)
    return state === undefined ? { kind: 'unwatched' } : { kind: 'terminal', state }
  }

  /** The record after one poll: the one place the watcher fields move, so no combination of them can be stored. */
  static readonly afterPoll = <Watch extends Omit<PullRequestRecord, 'id' | 'sessionId'>>(record: Watch, outcome: WatcherPollOutcome): Watch => {
    if (outcome.kind === 'rate-limited')
      return {
        ...record,
        lastCheckedAt: outcome.now,
        lastError: 'gh-command-failed',
        retryAfterAt: outcome.retryAfterAt,
        consecutiveRateLimits: outcome.count,
      }
    if (outcome.kind === 'failed') return { ...record, lastCheckedAt: outcome.now, lastError: outcome.error, retryAfterAt: null, consecutiveRateLimits: 0 }
    const terminal = outcome.snapshot.state === 'MERGED' || outcome.snapshot.state === 'CLOSED'
    return {
      ...record,
      watching: terminal ? false : true,
      lastKnownState: outcome.snapshot,
      lastCheckedAt: outcome.now,
      retryAfterAt: null,
      consecutiveRateLimits: 0,
      lastError: null,
    }
  }
}

const urlLocatorSchema = Schema.Struct({
  sessionId: Schema.optional(sessionIdSchema),
  url: githubPullRequestUrlSchema,
  cwd: Schema.optional(cwdSchema),
})

const numberLocatorSchema = Schema.Struct({
  sessionId: Schema.optional(sessionIdSchema),
  number: pullRequestNumberSchema,
  cwd: cwdSchema,
})

export const pullRequestLinkInputSchema = Schema.Union([urlLocatorSchema, numberLocatorSchema])
export type PullRequestLinkInput = Schema.Schema.Type<typeof pullRequestLinkInputSchema>

const urlTargetSchema = Schema.Struct({ sessionId: Schema.optional(sessionIdSchema), url: githubPullRequestUrlSchema })
const repositoryTargetSchema = Schema.Struct({ sessionId: Schema.optional(sessionIdSchema), repo: repositorySchema, number: pullRequestNumberSchema })

export const pullRequestTargetInputSchema = Schema.Union([urlTargetSchema, repositoryTargetSchema])
export type PullRequestTargetInput = Schema.Schema.Type<typeof pullRequestTargetInputSchema>

export const pullRequestListInputSchema = Schema.Struct({
  sessionId: Schema.optional(sessionIdSchema),
  all: Schema.optional(Schema.Boolean),
})

export const pullRequestListOutputSchema = Schema.Struct({
  links: Schema.Array(pullRequestLinkViewSchema),
  total: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  all: Schema.Boolean,
})

export const pullRequestMutationOutputSchema = Schema.Struct({ link: pullRequestLinkViewSchema })

export const pullRequestRemovalOutputSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  repo: repositorySchema,
  number: pullRequestNumberSchema,
  removed: Schema.Boolean,
})

export const summarizePullRequest = (view: GitHubPullRequestView): PullRequestSnapshot => {
  const normalizeStatus = (status: string): SupportedCheckStatus => {
    const normalized = status.toUpperCase()
    return supportedCheckStatuses.find(candidate => candidate === normalized) ?? 'UNKNOWN'
  }
  const safeAuthor = (login: string | null): string | null => (login === null ? null : login.replace(/[^A-Za-z0-9-]/gu, '').slice(0, 39))
  const checks = (view.statusCheckRollup ?? []).map(check => ({
    status: normalizeStatus('context' in check ? check.state : check.status === 'COMPLETED' ? (check.conclusion ?? 'UNKNOWN') : check.status),
  }))
  const comments = view.comments.map(comment => ({ at: comment.createdAt, author: safeAuthor(comment.author?.login ?? null) }))
  const reviews = view.reviews.flatMap(review =>
    review.submittedAt === null ? [] : [{ at: review.submittedAt, author: safeAuthor(review.author?.login ?? null) }],
  )
  const newest = (events: ReadonlyArray<Schema.Schema.Type<typeof pullRequestEventSchema>>) =>
    [...events].sort((left, right) => right.at.localeCompare(left.at) || (right.author ?? '').localeCompare(left.author ?? ''))[0] ?? null

  return {
    state: view.state,
    mergeable: view.mergeable,
    mergeStateStatus: view.mergeStateStatus,
    reviewDecision: view.reviewDecision,
    checks,
    commentsCount: view.commentsCount ?? view.comments.length,
    latestComment: newest(comments),
    reviewsCount: view.reviewsCount ?? view.reviews.length,
    latestReview: newest(reviews),
    body: view.body.slice(0, MAX_SNAPSHOT_BODY_CHARS),
  }
}

export type PullRequestTransition =
  | { readonly kind: 'ci-failed'; readonly count: number }
  | { readonly kind: 'required-checks-passed' }
  | { readonly kind: 'new-review'; readonly count: number; readonly event: PullRequestSnapshot['latestReview'] & {} }
  | { readonly kind: 'new-comment'; readonly count: number; readonly event: PullRequestSnapshot['latestComment'] & {} }
  | { readonly kind: 'conflicting' }
  | { readonly kind: 'merged' }
  | { readonly kind: 'closed' }

const failedCheckStatuses = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])

const failedCheckCount = (snapshot: PullRequestSnapshot): number => snapshot.checks.filter(check => failedCheckStatuses.has(check.status)).length

const requiredChecksPassed = (snapshot: PullRequestSnapshot): boolean =>
  snapshot.mergeStateStatus === 'CLEAN' && snapshot.checks.length > 0 && snapshot.checks.every(check => check.status.toUpperCase() === 'SUCCESS')

const hasNewEvent = (previous: PullRequestEvent | null, current: PullRequestEvent | null): boolean =>
  current !== null && (previous === null || current.at > previous.at || (current.at === previous.at && current.author !== previous.author))

export type PullRequestEvent = Schema.Schema.Type<typeof pullRequestEventSchema>

const newEventCount = (previousCount: number, currentCount: number, hasNew: boolean): number => Math.max(0, currentCount - previousCount, hasNew ? 1 : 0)

export const transitionPullRequest = (previous: PullRequestSnapshot | undefined, current: PullRequestSnapshot): readonly PullRequestTransition[] => {
  if (current.state === 'MERGED' && previous?.state !== 'MERGED') return [{ kind: 'merged' }]
  if (current.state === 'CLOSED' && previous?.state !== 'CLOSED') return [{ kind: 'closed' }]

  const transitions: PullRequestTransition[] = []
  const currentFailures = failedCheckCount(current)
  const previousFailures = previous === undefined ? 0 : failedCheckCount(previous)
  if (currentFailures > previousFailures) transitions.push({ kind: 'ci-failed', count: currentFailures - previousFailures })

  if (requiredChecksPassed(current) && (previous === undefined || !requiredChecksPassed(previous))) transitions.push({ kind: 'required-checks-passed' })

  if (previous !== undefined) {
    const commentIsNew = hasNewEvent(previous.latestComment, current.latestComment)
    const newCommentCount = newEventCount(previous.commentsCount, current.commentsCount, commentIsNew)
    if (newCommentCount > 0 && current.latestComment !== null) transitions.push({ kind: 'new-comment', count: newCommentCount, event: current.latestComment })

    const reviewIsNew = hasNewEvent(previous.latestReview, current.latestReview)
    const newReviewCount = newEventCount(previous.reviewsCount, current.reviewsCount, reviewIsNew)
    if (newReviewCount > 0 && current.latestReview !== null) transitions.push({ kind: 'new-review', count: newReviewCount, event: current.latestReview })
  }

  if (current.mergeable === 'CONFLICTING' && previous?.mergeable !== 'CONFLICTING') transitions.push({ kind: 'conflicting' })
  return transitions
}
