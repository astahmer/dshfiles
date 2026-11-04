import * as Schema from 'effect/Schema'

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const cwdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))
const pullRequestNumberSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))
const githubRepositorySchema = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u))

export const githubPullRequestUrlSchema = Schema.String.check(Schema.isPattern(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*\/?$/u))

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

const checkRollupSchema = Schema.Union([checkRunSchema, statusContextSchema])

const commentSchema = Schema.Struct({
  author: actorSchema,
  createdAt: githubTimestampSchema,
})

const reviewSchema = Schema.Struct({
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
})

export type PullRequestSnapshot = Schema.Schema.Type<typeof pullRequestSnapshotSchema>

const lastErrorSchema = Schema.NullOr(Schema.Literals(['gh-command-failed', 'invalid-response']))

export const pullRequestRecordSchema = Schema.Struct({
  id: Schema.String,
  sessionId: sessionIdSchema,
  repo: githubRepositorySchema,
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
  repo: githubRepositorySchema,
  number: pullRequestNumberSchema,
  url: githubPullRequestUrlSchema,
  watching: Schema.Boolean,
  lastKnownState: Schema.NullOr(pullRequestSnapshotSchema),
  lastCheckedAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  lastError: lastErrorSchema,
})

export type PullRequestLinkView = Schema.Schema.Type<typeof pullRequestLinkViewSchema>

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
const repositoryTargetSchema = Schema.Struct({ sessionId: Schema.optional(sessionIdSchema), repo: githubRepositorySchema, number: pullRequestNumberSchema })

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
  repo: githubRepositorySchema,
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
    commentsCount: view.comments.length,
    latestComment: newest(comments),
    reviewsCount: view.reviews.length,
    latestReview: newest(reviews),
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
