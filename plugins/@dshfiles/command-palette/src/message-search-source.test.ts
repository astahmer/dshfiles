import { createApiClient } from '@dshfiles/dshx/api/client'
import { sessionSearchApi, type SearchMessagesOutput } from '@dshfiles/session-search/search-api'
import { describe, expect, it, vi } from 'vitest'
import { MessageSearchSource } from './message-search-source.js'

/** A real contract client over a fake Connection, answering `searchMessages` the way each Host generation does. */
const hostAnswering = (answer: 'missing-plugin' | 'old-plugin' | 'timeout' | 'not-owner' | 'drifted') => {
  const client = createApiClient(
    {
      get: () => ({
        rpc: {
          call: async () => {
            if (answer === 'missing-plugin') throw new Error('HTTP 404')
            if (answer === 'old-plugin') return { ok: false, error: { code: 'bad-request', message: 'Unknown API method searchMessages.' } }
            if (answer === 'timeout') return { ok: false, error: { code: 'session-search-worker-timeout', message: 'worker timed out' } }
            if (answer === 'drifted') return { ok: true, value: { version: 1, output: { matches: 'nope' } } }
            return { ok: true, value: { version: 1, output: { ownsService: false, matches: [], hasMore: false } } }
          },
        },
      }),
    },
    sessionSearchApi,
  )
  return MessageSearchSource.create({ call: (input, signal) => client.searchMessages(input, { signal }) })
}

const page = {
  ownsService: true,
  hasMore: false,
  matches: [
    { sessionId: 'session-1', seq: 12, role: 'assistant', time: 1_700_000_000_000, snippet: 'Deployed quartz worker' },
    { sessionId: 'session-2', seq: 3, role: 'user', time: 1_700_000_100_000, snippet: 'Check quartz status', cwd: '/repo/a' },
  ],
} satisfies SearchMessagesOutput

describe('MessageSearchSource.create', () => {
  it('calls searchMessages through the session-search contract and returns decoded hits', async () => {
    const call = vi.fn(async () => page)
    const search = MessageSearchSource.create({ call })
    const signal = new AbortController().signal

    expect(await search({ query: '  quartz ', role: 'assistant' }, signal)).toEqual({ kind: 'ready', hasMore: false, hits: page.matches })
    expect(call).toHaveBeenCalledWith({ text: 'quartz', role: 'assistant', limit: 25 }, signal)
  })

  it('does not call the Host under two characters and cuts long text to the API bound', async () => {
    const call = vi.fn(async () => page)
    const search = MessageSearchSource.create({ call })
    const signal = new AbortController().signal

    expect(await search({ query: ' q ', role: 'all' }, signal)).toEqual({ kind: 'ready', hits: [], hasMore: false })
    expect(call).not.toHaveBeenCalled()
    await search({ query: `${'a'.repeat(511)}😀tail`, role: 'all' }, signal)
    expect(call).toHaveBeenCalledWith({ text: 'a'.repeat(511), role: 'all', limit: 25 }, signal)
  })

  it('tells a missing or outdated session-search from one that does not own search, and throws other failures', async () => {
    const signal = new AbortController().signal
    expect(await hostAnswering('missing-plugin')({ query: 'quartz', role: 'all' }, signal)).toEqual({ kind: 'unavailable', reason: 'missing' })
    expect(await hostAnswering('old-plugin')({ query: 'quartz', role: 'all' }, signal)).toEqual({ kind: 'unavailable', reason: 'missing' })
    expect(await hostAnswering('not-owner')({ query: 'quartz', role: 'all' }, signal)).toEqual({ kind: 'unavailable', reason: 'not-owner' })
    await expect(hostAnswering('timeout')({ query: 'quartz', role: 'all' }, signal)).rejects.toThrow('worker timed out')

    await expect(hostAnswering('drifted')({ query: 'quartz', role: 'all' }, signal)).rejects.toThrow('unexpected shape')
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

  it('keeps a pasted query within the focus contract bound', () => {
    const requestFocus = vi.fn()
    MessageSearchSource.applySelection({
      behavior: 'reveal',
      sessionId: 'session-1',
      seq: 2,
      role: 'user',
      query: 'x'.repeat(2_000),
      openSession: () => {},
      requestFocus,
    })
    expect(requestFocus).toHaveBeenCalledWith({ seq: 2, type: 'user/message', query: 'x'.repeat(512) })
  })
})
