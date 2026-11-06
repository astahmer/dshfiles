import { describe, expect, it } from 'vitest'
import { PullRequestWatcher, type PullRequestRecord, type PullRequestSnapshot } from './pull-request-model.js'

const snapshot = (state: PullRequestSnapshot['state'] = 'OPEN'): PullRequestSnapshot => ({
  state,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewDecision: null,
  checks: [],
  commentsCount: 0,
  latestComment: null,
  reviewsCount: 0,
  latestReview: null,
})

const record = (fields: Partial<PullRequestRecord> = {}): PullRequestRecord => ({
  id: 'link-1',
  sessionId: 'session-abc123',
  repo: 'astahmer/dshfiles',
  number: 1,
  url: 'https://github.com/astahmer/dshfiles/pull/1',
  cwd: '/tmp',
  watching: true,
  lastKnownState: null,
  lastCheckedAt: null,
  retryAfterAt: null,
  consecutiveRateLimits: 0,
  lastError: null,
  ...fields,
})

describe('watcher status', () => {
  it('reads watching, backoff, failed, terminal and unwatched from one record', () => {
    expect(PullRequestWatcher.statusOf(record(), 1_000)).toEqual({ kind: 'watching' })
    expect(PullRequestWatcher.statusOf(record({ retryAfterAt: 5_000, consecutiveRateLimits: 3 }), 1_000)).toEqual({ kind: 'backoff', until: 5_000, count: 3 })
    expect(PullRequestWatcher.statusOf(record({ lastError: 'invalid-response' }), 1_000)).toEqual({ kind: 'failed', error: 'invalid-response' })
    expect(PullRequestWatcher.statusOf(record({ watching: false, lastKnownState: snapshot('MERGED') }), 1_000)).toEqual({ kind: 'terminal', state: 'MERGED' })
    expect(PullRequestWatcher.statusOf(record({ watching: false, lastKnownState: snapshot('CLOSED') }), 1_000)).toEqual({ kind: 'terminal', state: 'CLOSED' })
    expect(PullRequestWatcher.statusOf(record({ watching: false }), 1_000)).toEqual({ kind: 'unwatched' })
  })

  it('treats an elapsed retry as a failed watcher again, so the next poll runs', () => {
    expect(PullRequestWatcher.statusOf(record({ retryAfterAt: 900, lastError: 'gh-command-failed' }), 1_000)).toEqual({
      kind: 'failed',
      error: 'gh-command-failed',
    })
  })
})

describe('watcher record after a poll', () => {
  it('keeps watching an open pull request and clears the previous failure', () => {
    const after = PullRequestWatcher.afterPoll(record({ lastError: 'invalid-response', retryAfterAt: 9_000, consecutiveRateLimits: 4 }), {
      kind: 'ok',
      snapshot: snapshot('OPEN'),
      now: 2_000,
    })
    expect(PullRequestWatcher.statusOf(after, 2_000)).toEqual({ kind: 'watching' })
    expect(after.lastKnownState?.state).toBe('OPEN')
    expect(after.lastCheckedAt).toBe(2_000)
  })

  it('stops watching a merged pull request and remembers that it is terminal', () => {
    const after = PullRequestWatcher.afterPoll(record(), { kind: 'ok', snapshot: snapshot('MERGED'), now: 2_000 })
    expect(after.watching).toBe(false)
    expect(PullRequestWatcher.statusOf(after, 2_000)).toEqual({ kind: 'terminal', state: 'MERGED' })
  })

  it('moves into backoff with the count the monitor computed, and into failure without a retry', () => {
    const rateLimited = PullRequestWatcher.afterPoll(record({ consecutiveRateLimits: 1 }), { kind: 'rate-limited', now: 2_000, retryAfterAt: 62_000, count: 2 })
    expect(PullRequestWatcher.statusOf(rateLimited, 2_000)).toEqual({ kind: 'backoff', until: 62_000, count: 2 })

    const failed = PullRequestWatcher.afterPoll(rateLimited, { kind: 'failed', now: 3_000, error: 'invalid-response' })
    expect(PullRequestWatcher.statusOf(failed, 3_000)).toEqual({ kind: 'failed', error: 'invalid-response' })
    expect(failed.consecutiveRateLimits).toBe(0)
  })
})
