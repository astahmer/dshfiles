import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { createBtwSource } from './btw-source.js'

const session = { sessionId: SessionId('session-1') }
const request = (query: string, position: 'leading' | 'inline') => ({ query, position, drilled: false, signal: new AbortController().signal })
const submitted: string[] = []
const source = createBtwSource({
  description: 'Ask a side question about this thread without touching it',
  claimFor: sessionId => ({
    name: 'btw',
    token: '/btw ',
    hint: 'Ask about this thread',
    submit: async args => {
      submitted.push(`${sessionId}:${args}`)
      return { kind: 'success' }
    },
  }),
})

describe('btw composer command', () => {
  it('offers btw while the leading query prefixes its name', async () => {
    expect(await source.candidates(session, request('bt', 'leading'))).toEqual([
      { name: 'btw', description: 'Ask a side question about this thread without touching it' },
    ])
    expect(await source.candidates(session, request('bt', 'inline'))).toEqual([])
    expect(await source.candidates(session, request('goal', 'leading'))).toEqual([])
  })

  it('claims the whole line only for /btw and /btw <args>', async () => {
    expect(await source.matchEnter?.(session, '/btw', new AbortController().signal, { attachments: 0 })).toMatchObject({ claim: { name: 'btw' } })
    expect(await source.matchEnter?.(session, '/btw what is this?', new AbortController().signal, { attachments: 0 })).toMatchObject({ claim: { name: 'btw' } })
    expect(await source.matchEnter?.(session, '/btwfoo', new AbortController().signal, { attachments: 0 })).toBeUndefined()
  })

  it('answers a persisted /btw chip with its claim and performs nothing', async () => {
    const claim = await source.matchClaim?.(session, '/btw', new AbortController().signal)
    expect(claim).toMatchObject({ name: 'btw', token: '/btw ' })
    expect(submitted).toEqual([])
    expect(await source.matchClaim?.(session, '/goal', new AbortController().signal)).toBeUndefined()
  })
})
