import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@dshfiles/plugin-ui/query'
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

describe('readSummaryFiles', () => {
  const signal = new AbortController().signal

  it('reads a served summary as its files', async () => {
    const body = { turn: 1, files: [{ path: 'a.ts', display: 'a.ts', added: 1, deleted: 0 }], total: 1, added: 1, deleted: 0 }
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => body }))
    await expect(ReviewFileModel.readSummaryFiles(fetchImpl, 'api/changes.summary?sessionId=s&seq=1', signal)).resolves.toEqual([
      { path: 'a.ts', display: 'a.ts' },
    ])
  })

  it('reads a summary the Host no longer serves (404) as no summary, without throwing', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    await expect(ReviewFileModel.readSummaryFiles(fetchImpl, 'api/changes.summary?sessionId=s&seq=1', signal)).resolves.toBeNull()
  })
})

describe('summaryQueryOptions', () => {
  it('asks the Host for one turn summary once, even when a later file selection mounts the toggle again', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
    const queryFn = vi.fn(async () => null)
    const options = { queryKey: ['diff-viewed', 'summary', 'api/changes.summary?sessionId=s&seq=1'], queryFn, ...ReviewFileModel.summaryQueryOptions }
    const first = new QueryObserver(client, options)
    const unsubscribe = first.subscribe(() => {})
    await vi.waitFor(() => expect(client.getQueryState(options.queryKey)?.status).toBe('success'))
    unsubscribe()
    // Past the plugin client's 30 s staleTime, where the previous options re-asked on every remount.
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 60_000)
    const again = new QueryObserver(client, options)
    const stop = again.subscribe(() => {})
    await new Promise(resolve => setTimeout(resolve, 20))
    stop()
    vi.restoreAllMocks()
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(options.queryKey)).toBeNull()
  })
})
