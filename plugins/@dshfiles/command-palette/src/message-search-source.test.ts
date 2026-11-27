import { describe, expect, it, vi } from 'vitest'
import { MessageSearchSource } from './message-search-source.js'

const SESSION_SEARCH_API = {
  owner: '@dshfiles/session-search',
  id: 'session-search',
  version: 1,
  methods: [{ name: 'health' }, { name: 'findInThread' }, { name: 'searchMessages' }],
}

describe('MessageSearchSource.create', () => {
  it('discovers session-search once and returns decoded user/assistant message hits', async () => {
    const listApis = vi.fn(async () => [SESSION_SEARCH_API])
    const callSearch = vi.fn(async () =>
      MessageSearchSource.decodePage({
        ownsService: true,
        hasMore: false,
        matches: [
          { sessionId: 'session-1', seq: 12, role: 'assistant', time: 1_700_000_000_000, snippet: 'Deployed quartz worker' },
          { sessionId: 'session-2', seq: 3, role: 'user', time: 1_700_000_100_000, snippet: 'Check quartz status', cwd: '/repo/a' },
        ],
      }),
    )
    const search = MessageSearchSource.create({ listApis, callSearch })
    const signal = new AbortController().signal

    const first = await search({ query: 'quartz', role: 'all' }, signal)
    const second = await search({ query: 'quartz', role: 'assistant' }, signal)

    expect(listApis).toHaveBeenCalledTimes(1)
    expect(callSearch).toHaveBeenNthCalledWith(
      1,
      { owner: '@dshfiles/session-search', id: 'session-search', version: 1 },
      { text: 'quartz', role: 'all', limit: 25 },
      signal,
    )
    expect(callSearch).toHaveBeenNthCalledWith(
      2,
      { owner: '@dshfiles/session-search', id: 'session-search', version: 1 },
      { text: 'quartz', role: 'assistant', limit: 25 },
      signal,
    )
    expect(first).toEqual({
      kind: 'ready',
      hasMore: false,
      hits: [
        { sessionId: 'session-1', seq: 12, role: 'assistant', time: 1_700_000_000_000, snippet: 'Deployed quartz worker' },
        { sessionId: 'session-2', seq: 3, role: 'user', time: 1_700_000_100_000, snippet: 'Check quartz status', cwd: '/repo/a' },
      ],
    })
    expect(second.kind).toBe('ready')
  })

  it('returns unavailable when session-search is absent, lacks searchMessages, or does not own the service', async () => {
    const signal = new AbortController().signal

    const olderHost = MessageSearchSource.create({
      listApis: async () => [{ owner: '@dshfiles/session-search', id: 'session-search', version: 1, methods: [{ name: 'findInThread' }] }],
      callSearch: vi.fn(),
    })
    expect(await olderHost({ query: 'quartz', role: 'all' }, signal)).toEqual({ kind: 'unavailable' })

    const notOwner = MessageSearchSource.create({
      listApis: async () => [SESSION_SEARCH_API],
      callSearch: async () => ({ ownsService: false, matches: [], hasMore: false }),
    })
    expect(await notOwner({ query: 'quartz', role: 'all' }, signal)).toEqual({ kind: 'unavailable' })
  })
})

describe('MessageSearchSource.applySelection', () => {
  it('opens the thread and requests message focus when behavior is reveal, and only opens when behavior is open', () => {
    const openReveal = vi.fn()
    const focusReveal = vi.fn()
    MessageSearchSource.applySelection({
      behavior: 'reveal',
      sessionId: 'session-1',
      seq: 18,
      role: 'assistant',
      query: '  quartz  ',
      openSession: openReveal,
      requestFocus: focusReveal,
    })
    expect(openReveal).toHaveBeenCalledTimes(1)
    expect(focusReveal).toHaveBeenCalledWith({ seq: 18, type: 'assistant/message', query: 'quartz' })

    const openOnly = vi.fn()
    const focusOnly = vi.fn()
    MessageSearchSource.applySelection({
      behavior: 'open',
      sessionId: 'session-1',
      seq: 18,
      role: 'user',
      query: 'quartz',
      openSession: openOnly,
      requestFocus: focusOnly,
    })
    expect(openOnly).toHaveBeenCalledTimes(1)
    expect(focusOnly).not.toHaveBeenCalled()
  })
})
