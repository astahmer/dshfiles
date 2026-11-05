import { describe, expect, it } from '@effect/vitest'
import { Schema } from 'effect'
import { githubPullRequestJsonSchema } from '../src/github-cli.js'
import { summarizePullRequest, transitionPullRequest, type PullRequestEvent, type PullRequestSnapshot } from '../src/pull-request-model.js'

const decodeGitHubPullRequestJson = Schema.decodeUnknownSync(githubPullRequestJsonSchema)

const snapshot = (overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot => ({
  state: 'OPEN',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'BLOCKED',
  reviewDecision: null,
  checks: [],
  commentsCount: 0,
  latestComment: null,
  reviewsCount: 0,
  latestReview: null,
  ...overrides,
})

const event = (at: string, author: string): PullRequestEvent => ({ at, author })

describe('GitHub pull-request decoding', () => {
  it('decodes the requested gh JSON fields and summarizes checks, comments and reviews', () => {
    const view = decodeGitHubPullRequestJson(
      JSON.stringify({
        state: 'OPEN',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        reviewDecision: 'APPROVED',
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://example.test/run/1' },
          { __typename: 'StatusContext', context: 'lint', state: 'SUCCESS', targetUrl: 'https://example.test/lint' },
        ],
        comments: [
          { author: { login: 'reviewer' }, createdAt: '2026-11-01T10:00:00Z', url: 'https://github.com/acme/widget/pull/42#issuecomment-1', body: 'ignored' },
        ],
        reviews: [
          {
            author: { login: 'reviewer' },
            state: 'APPROVED',
            submittedAt: '2026-11-01T11:00:00Z',
            url: 'https://github.com/acme/widget/pull/42#pullrequestreview-1',
            body: 'ignored',
          },
          { author: null, state: 'PENDING', submittedAt: null, url: 'https://github.com/acme/widget/pull/42#pullrequestreview-2' },
        ],
        title: 'Not retained',
      }),
    )

    expect(summarizePullRequest(view)).toEqual({
      state: 'OPEN',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: 'APPROVED',
      checks: [{ status: 'SUCCESS' }, { status: 'SUCCESS' }],
      commentsCount: 1,
      latestComment: {
        at: '2026-11-01T10:00:00Z',
        author: 'reviewer',
      },
      reviewsCount: 2,
      latestReview: {
        at: '2026-11-01T11:00:00Z',
        author: 'reviewer',
      },
    })
  })

  it('rejects syntactically valid JSON that does not match the GitHub schema', () => {
    expect(() => decodeGitHubPullRequestJson(JSON.stringify({ state: 'OPEN', comments: [] }))).toThrow()
  })
})

describe('pull-request transitions', () => {
  it('detects CI failure, new comments and reviews, and newly conflicting state once', () => {
    const before = snapshot({
      checks: [{ status: 'IN_PROGRESS' }],
      commentsCount: 1,
      latestComment: event('2026-11-01T10:00:00Z', 'alice'),
    })
    const after = snapshot({
      mergeable: 'CONFLICTING',
      checks: [{ status: 'FAILURE' }],
      commentsCount: 2,
      latestComment: event('2026-11-01T12:00:00Z', 'bob'),
      reviewsCount: 1,
      latestReview: event('2026-11-01T11:00:00Z', 'carol'),
    })

    expect(transitionPullRequest(before, after)).toEqual([
      { kind: 'ci-failed', count: 1 },
      { kind: 'new-comment', count: 1, event: after.latestComment },
      { kind: 'new-review', count: 1, event: after.latestReview },
      { kind: 'conflicting' },
    ])
    expect(transitionPullRequest(after, after)).toEqual([])
  })

  it('reports the clean required-check state only when every returned check passes', () => {
    const pending = snapshot({ checks: [{ status: 'IN_PROGRESS' }] })
    const passed = snapshot({ mergeStateStatus: 'CLEAN', checks: [{ status: 'SUCCESS' }] })
    const oneFailed = snapshot({ mergeStateStatus: 'CLEAN', checks: [{ status: 'SUCCESS' }, { status: 'FAILURE' }] })

    expect(transitionPullRequest(pending, passed)).toEqual([{ kind: 'required-checks-passed' }])
    expect(transitionPullRequest(pending, oneFailed)).toEqual([{ kind: 'ci-failed', count: 1 }])
  })

  it('treats merged and closed as terminal transitions', () => {
    expect(transitionPullRequest(snapshot(), snapshot({ state: 'MERGED' }))).toEqual([{ kind: 'merged' }])
    expect(transitionPullRequest(snapshot(), snapshot({ state: 'CLOSED' }))).toEqual([{ kind: 'closed' }])
  })
})
