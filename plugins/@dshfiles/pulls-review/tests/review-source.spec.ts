import { describe, expect, it } from 'vitest'
import type { ReviewResult } from '../src/api.js'
import { reviewWithHistoryFallback } from '../src/review-source.js'

const missingWorkspace: ReviewResult = {
  status: 'failed',
  path: '/projects/demo/.threads/thread-a1b2c3',
  reason: 'workspace-missing',
  message: 'That thread workspace is no longer on disk.',
}

const successfulReview = (path: string, range: string): ReviewResult => ({
  status: 'ok',
  path,
  base: range.split('..')[0] ?? '',
  head: range.split('..')[1] ?? '',
  range,
  patch: '',
  truncated: false,
  fileCount: 0,
  additions: 0,
  deletions: 0,
  files: [],
  scopes: [],
})

describe('review source fallback', () => {
  it('uses the latest landed exact range after the thread workspace is missing', async () => {
    const requests: { readonly path: string; readonly fromChangeId?: string; readonly toChangeId?: string }[] = []
    const result = await reviewWithHistoryFallback({
      path: missingWorkspace.path,
      readReview: async input => {
        requests.push(input)
        return input.fromChangeId === undefined ? missingWorkspace : successfulReview(input.path, `${input.fromChangeId}..${input.toChangeId ?? ''}`)
      },
      readHistory: async () => ({
        repoRoot: '/projects/demo',
        integrations: [
          { baseChangeId: 'older-base', tipChangeId: 'older-head' },
          { baseChangeId: 'latest-base', tipChangeId: 'latest-head' },
        ],
      }),
    })

    expect(requests).toEqual([{ path: missingWorkspace.path }, { path: '/projects/demo', fromChangeId: 'latest-base', toChangeId: 'latest-head' }])
    expect(result).toMatchObject({ status: 'ok', range: 'latest-base..latest-head' })
  })

  it('preserves live-workspace review without querying history', async () => {
    const live = successfulReview(missingWorkspace.path, 'main..@')
    const result = await reviewWithHistoryFallback({
      path: missingWorkspace.path,
      readReview: async () => live,
      readHistory: async () => {
        throw new Error('history should not be read')
      },
    })

    expect(result).toBe(live)
  })

  it('preserves the missing-workspace result when history has no exact range', async () => {
    const result = await reviewWithHistoryFallback({
      path: missingWorkspace.path,
      readReview: async () => missingWorkspace,
      readHistory: async () => ({ repoRoot: '/projects/demo', integrations: [{ tipChangeId: 'head-without-base' }] }),
    })

    expect(result).toBe(missingWorkspace)
  })
})
