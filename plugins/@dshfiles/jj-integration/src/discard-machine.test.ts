import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { discardMachine } from './discard-machine.js'

type Reply = { readonly status: 'discarded' | 'has-work' } | Error

const startDiscard = (replies: readonly Reply[]) => {
  const calls: { readonly path: string; readonly force: boolean }[] = []
  let settled = 0
  const actor = createActor(discardMachine, {
    input: {
      client: {
        discard: async input => {
          calls.push(input)
          const reply = replies[calls.length - 1] ?? { status: 'discarded' }
          if (reply instanceof Error) throw reply
          return reply
        },
      },
    },
  })
  actor.on('settled', () => {
    settled += 1
  })
  actor.start()
  return { actor, calls, settledCount: () => settled }
}

describe('discard confirmation', () => {
  it('forces the discard only when the dialog named unlanded revisions', async () => {
    const { actor, calls, settledCount } = startDiscard([{ status: 'discarded' }, { status: 'discarded' }])
    actor.send({ type: 'request', target: { path: '/threads/empty', name: 'empty', unlandedCount: 0 } })
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('closed'))
    actor.send({ type: 'request', target: { path: '/threads/busy', name: 'busy', unlandedCount: 3 } })
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('closed'))
    expect(calls).toEqual([
      { path: '/threads/empty', force: false },
      { path: '/threads/busy', force: true },
    ])
    expect(settledCount()).toBe(2)
  })

  it('never retries once the Host reports work that appeared after the dialog opened', async () => {
    const { actor, calls } = startDiscard([{ status: 'has-work' }])
    actor.send({ type: 'request', target: { path: '/threads/raced', name: 'raced', unlandedCount: 0 } })
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('failed'))
    actor.send({ type: 'confirm' })
    expect(actor.getSnapshot().context.failure).toEqual({ kind: 'has-work' })
    expect(calls).toHaveLength(1)
  })

  it('lets the person retry after a Host error', async () => {
    const { actor, calls } = startDiscard([new Error('jj workspace forget failed'), { status: 'discarded' }])
    actor.send({ type: 'request', target: { path: '/threads/flaky', name: 'flaky', unlandedCount: 0 } })
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('failed'))
    expect(actor.getSnapshot().context.failure).toEqual({ kind: 'failed', message: 'jj workspace forget failed' })
    actor.send({ type: 'confirm' })
    await waitFor(actor, snapshot => snapshot.matches('closed'))
    expect(calls).toHaveLength(2)
  })
})
