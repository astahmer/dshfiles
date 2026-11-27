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

const settle = async (): Promise<void> => {
  for (let tick = 0; tick < 4; tick += 1) await Promise.resolve()
}

const deferredClient = () => {
  const pending: Array<{
    readonly role: MessageSearchRole
    readonly query: string
    readonly signal: AbortSignal
    readonly resolve: (value: MessageSearchOutcome) => void
    readonly reject: (error: Error) => void
  }> = []
  const client = {
    search: ({ query, role }: { readonly query: string; readonly role: MessageSearchRole }, signal: AbortSignal) =>
      new Promise<MessageSearchOutcome>((resolve, reject) => {
        pending.push({ role, query, signal, resolve, reject })
      }),
  }
  return { client, pending }
}

describe('messageSearchMachine', () => {
  it('clears stale hits immediately when switching role and keeps only the latest response', async () => {
    const { client, pending } = deferredClient()
    const actor = createActor(messageSearchMachine, { input: { client } })
    actor.start()

    actor.send({ type: 'query.change', query: 'quartz', role: 'all', resetHits: false })
    expect(actor.getSnapshot().context.state.status).toBe('searching')
    pending[0]?.resolve({ kind: 'ready', hits: [hit(1, 'user'), hit(2, 'assistant')], hasMore: false })
    await settle()
    expect(actor.getSnapshot().context.state).toEqual({ status: 'done', unavailable: null, hits: [hit(1, 'user'), hit(2, 'assistant')], hasMore: false })

    actor.send({ type: 'query.change', query: 'quartz', role: 'assistant', resetHits: true })
    expect(actor.getSnapshot().context.state).toEqual({ status: 'searching', unavailable: null, hits: [], hasMore: false })
    pending[1]?.resolve({ kind: 'ready', hits: [hit(2, 'assistant')], hasMore: true })
    await settle()
    expect(actor.getSnapshot().context.state).toEqual({ status: 'done', unavailable: null, hits: [hit(2, 'assistant')], hasMore: true })
    actor.stop()
  })

  it('aborts a superseded search and ignores its late answer', async () => {
    const { client, pending } = deferredClient()
    const actor = createActor(messageSearchMachine, { input: { client } })
    actor.start()

    actor.send({ type: 'query.change', query: 'quartz', role: 'all', resetHits: false })
    actor.send({ type: 'query.change', query: 'quartz', role: 'user', resetHits: true })
    expect(pending[0]?.signal.aborted).toBe(true)
    pending[1]?.resolve({ kind: 'ready', hits: [hit(4, 'user')], hasMore: false })
    await settle()
    pending[0]?.resolve({ kind: 'ready', hits: [hit(9, 'assistant')], hasMore: false })
    await settle()
    expect(actor.getSnapshot().context.state.hits).toEqual([hit(4, 'user')])

    actor.send({ type: 'query.change', query: 'q', role: 'user', resetHits: false })
    expect(actor.getSnapshot().context.state).toEqual({ status: 'idle', unavailable: null, hits: [], hasMore: false })
    expect(pending).toHaveLength(2)
    actor.stop()
  })

  it('reports why search is unavailable, and a failed call separately', async () => {
    const { client, pending } = deferredClient()
    const actor = createActor(messageSearchMachine, { input: { client } })
    actor.start()

    actor.send({ type: 'query.change', query: 'quartz', role: 'all', resetHits: false })
    pending[0]?.resolve({ kind: 'unavailable', reason: 'not-owner' })
    await settle()
    expect(actor.getSnapshot().context.state).toEqual({ status: 'unavailable', unavailable: 'not-owner', hits: [], hasMore: false })

    actor.send({ type: 'query.change', query: 'quartz worker', role: 'all', resetHits: false })
    pending[1]?.reject(new Error('worker timed out'))
    await settle()
    expect(actor.getSnapshot().context.state).toEqual({ status: 'failed', unavailable: null, hits: [], hasMore: false })
    actor.stop()
  })
})
