import { describe, expect, it } from 'vitest'
import { changesSummaryUrl, parseChangesSummaryFiles, parseReviewCoordinates } from './review-file.js'

describe('parseReviewCoordinates', () => {
  it('reads the session, sequence and index from the review tab action route', () => {
    const actionUrl = `api/changes.open?${new URLSearchParams({ sessionId: 'session-1', seq: '42', index: '3' })}`
    expect(parseReviewCoordinates(actionUrl)).toEqual({ sessionId: 'session-1', seq: 42, index: 3 })
  })

  it('refuses a route without a query or with a malformed index', () => {
    expect(parseReviewCoordinates('api/changes.open')).toBeUndefined()
    expect(parseReviewCoordinates('api/changes.open?sessionId=s&seq=1&index=-1')).toBeUndefined()
    expect(parseReviewCoordinates('api/changes.open?sessionId=&seq=1&index=0')).toBeUndefined()
  })
})

describe('changesSummaryUrl', () => {
  it('addresses the summary route the review tab reads', () => {
    expect(changesSummaryUrl({ sessionId: 'a b', seq: 7 })).toBe('api/changes.summary?sessionId=a+b&seq=7')
  })
})

describe('parseChangesSummaryFiles', () => {
  it('keeps the listed files of a served summary', () => {
    const summary = { turn: 1, files: [{ path: 'src/a.ts', display: 'src/a.ts', added: 1, deleted: 0 }], total: 1, added: 1, deleted: 0 }
    expect(parseChangesSummaryFiles(summary)).toEqual([{ path: 'src/a.ts', display: 'src/a.ts' }])
  })

  it('refuses a body that is not a summary', () => {
    expect(parseChangesSummaryFiles({ error: 'gone' })).toBeUndefined()
    expect(parseChangesSummaryFiles(undefined)).toBeUndefined()
  })
})
