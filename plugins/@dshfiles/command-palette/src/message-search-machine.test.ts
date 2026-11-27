import { describe, expect, it } from 'vitest'
import { createActor } from '@dshfiles/plugin-ui/machine'
import { messageSearchMachine } from './message-search-machine.js'
import type { MessageHit, MessageSearchOutcome, MessageSearchRole } from './message-search-source.js'

const hit = (seq: number, role: 'user' | 'assistant'): MessageHit => ({
  sessionId: 'session-1',
  seq,
  role,
  time: 1_700_000_000_000 + seq,
  snippet: `message ${String(seq)}`,
})

describe('messageSearchMachine', () => {
  it('clears stale hits immediately when switching role and keeps only the latest response', async () => {
    const pending: Array<{
      readonly role: MessageSearchRole
      readonly resolve: (value: MessageSearchOutcome) => void
    }> = []
    const actor = createActor(messageSearchMachine, {
      input: {
        client: {
          search: ({ role }) =>
            new Promise<MessageSearchOutcome>(resolve => {
              pending.push({ role, resolve })
            }),
        },
      },
    })
    actor.start()

    actor.send({ type: 'query.change', query: 'quartz', role: 'all', available: true, resetHits: false })
    expect(actor.getSnapshot().context.state.status).toBe('searching')
    pending[0]?.resolve({ kind: 'ready', hits: [hit(1, 'user'), hit(2, 'assistant')], hasMore: false })
    await Promise.resolve()
    await Promise.resolve()
    expect(actor.getSnapshot().context.state).toEqual({
      status: 'done',
      hits: [hit(1, 'user'), hit(2, 'assistant')],
      hasMore: false,
    })

    actor.send({ type: 'query.change', query: 'quartz', role: 'assistant', available: true, resetHits: true })
    expect(actor.getSnapshot().context.state).toEqual({ status: 'searching', hits: [], hasMore: false })

    pending[1]?.resolve({ kind: 'ready', hits: [hit(2, 'assistant')], hasMore: false })
    await Promise.resolve()
    await Promise.resolve()
    expect(actor.getSnapshot().context.state).toEqual({
      status: 'done',
      hits: [hit(2, 'assistant')],
      hasMore: false,
    })

    actor.stop()
  })

  it('reports unavailable when the search source answers unavailable', async () => {
    const actor = createActor(messageSearchMachine, {
      input: {
        client: {
          search: async () => ({ kind: 'unavailable' }),
        },
      },
    })
    actor.start()
    actor.send({ type: 'query.change', query: 'quartz', role: 'all', available: true, resetHits: false })
    await Promise.resolve()
    await Promise.resolve()
    expect(actor.getSnapshot().context.state).toEqual({ status: 'unavailable', hits: [], hasMore: false })
    actor.stop()
  })
})
