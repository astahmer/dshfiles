import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewFileModel } from './review-file.js'

describe('parseReviewCoordinates', () => {
  it('reads the session, sequence and index from the review tab action route', () => {
    const actionUrl = `api/changes.open?${new URLSearchParams({ sessionId: 'session-1', seq: '42', index: '3' })}`
    expect(ReviewFileModel.parseReviewCoordinates(actionUrl)).toEqual({ sessionId: 'session-1', seq: 42, index: 3 })
  })

  it('refuses a route without a query or with a malformed index', () => {
    expect(ReviewFileModel.parseReviewCoordinates('api/changes.open')).toBeUndefined()
    expect(ReviewFileModel.parseReviewCoordinates('api/changes.open?sessionId=s&seq=1&index=-1')).toBeUndefined()
    expect(ReviewFileModel.parseReviewCoordinates('api/changes.open?sessionId=&seq=1&index=0')).toBeUndefined()
  })
})

describe('changesSummaryUrl', () => {
  it('addresses the summary route the review tab reads', () => {
    expect(ReviewFileModel.changesSummaryUrl({ sessionId: 'a b', seq: 7 })).toBe('api/changes.summary?sessionId=a+b&seq=7')
  })
})

describe('parseChangesSummaryFiles', () => {
  it('keeps the listed files of a served summary', () => {
    const summary = { turn: 1, files: [{ path: 'src/a.ts', display: 'src/a.ts', added: 1, deleted: 0 }], total: 1, added: 1, deleted: 0 }
    expect(ReviewFileModel.parseChangesSummaryFiles(summary)).toEqual([{ path: 'src/a.ts', display: 'src/a.ts' }])
  })

  it('refuses a body that is not a summary', () => {
    expect(ReviewFileModel.parseChangesSummaryFiles({ error: 'gone' })).toBeUndefined()
    expect(ReviewFileModel.parseChangesSummaryFiles(undefined)).toBeUndefined()
  })
})

describe('readChangesSummaryFiles', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const read = () => ReviewFileModel.readChangesSummaryFiles('api/changes.summary?sessionId=s&seq=1', new AbortController().signal)

  it('reads nothing from 204 No Content, which the Host answers once the turn expired', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }))
    expect(await read()).toBeUndefined()
  })

  it('reads nothing from a 404, which an older Host answers', async () => {
    vi.stubGlobal('fetch', async () => new Response('Change summary unavailable.', { status: 404 }))
    expect(await read()).toBeUndefined()
  })
})
