import { QueryClient } from '@dshfiles/plugin-ui/query'
import { describe, expect, it } from 'vitest'
import { MessagePages } from './message-pages.js'

const page = (ids: readonly string[]) => ({ items: ids.map(id => ({ id })), nextCursor: null, totalMatching: ids.length })

describe('mergeMessagePages', () => {
  it('replaces the newest page with the head and keeps what fell out of its window', () => {
    const merged = MessagePages.merge({ head: page(['d', 'c']), pages: [page(['c', 'b']), page(['a'])] })
    expect(merged.map(entry => entry.items.map(message => message.id))).toEqual([['d', 'c', 'b'], ['a']])
    // The head's own page metadata survives the merge.
    expect(merged[0]?.totalMatching).toBe(2)
  })

  it('drops an id an older page repeats from the head', () => {
    const merged = MessagePages.merge({ head: page(['d', 'c']), pages: [page(['c']), page(['a', 'c'])] })
    expect(merged.map(entry => entry.items.map(message => message.id))).toEqual([['d', 'c'], ['a']])
  })

  it('keeps the loaded pages untouched until the head arrives', () => {
    const pages = [page(['b']), page(['a'])]
    expect(MessagePages.merge({ head: undefined, pages })).toBe(pages)
  })

  it('answers the head alone when nothing older is loaded', () => {
    expect(MessagePages.merge({ head: page(['a']), pages: [] }).map(entry => entry.items.map(message => message.id))).toEqual([['a']])
  })
})

describe('message query shape', () => {
  it('keeps the head a single polling query and loaded history a non-polling one', async () => {
    const calls = { head: 0, history: 0 }
    const browseFor = (counter: 'head' | 'history') => (beforeId: string | null) => {
      calls[counter] += 1
      return Promise.resolve({ items: [{ id: beforeId ?? counter }], nextCursor: beforeId === null ? 'cursor-1' : null, totalMatching: 2 })
    }
    const client = new QueryClient()
    const historyOptions = MessagePages.historyOptions({ queryKey: ['browse'], enabled: true, browse: browseFor('history') })
    const headOptions = MessagePages.headOptions({ queryKey: ['browse'], enabled: true, browse: browseFor('head') })

    // An infinite-query refetch walks every loaded page, which is why the periodic refresh is not on it.
    await client.fetchInfiniteQuery(historyOptions)
    await client.fetchQuery(headOptions)
    expect(calls).toEqual({ head: 1, history: 1 })
    expect(historyOptions.refetchInterval).toBe(false)
    expect(headOptions.refetchInterval).toBe(MessagePages.headRefreshIntervalMs)
    expect(headOptions.queryKey).not.toEqual(historyOptions.queryKey)
    client.clear()
  })
})
