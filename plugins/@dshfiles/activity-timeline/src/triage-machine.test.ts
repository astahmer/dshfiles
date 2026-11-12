import { createActor, fromPromise } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { triageMachine, TriageModel, type TriageRequest } from './triage-machine.js'

describe('triageMachine', () => {
  const start = (run: (request: TriageRequest) => Promise<void>) => {
    const actor = createActor(triageMachine.provide({ actors: { run: fromPromise<void, TriageRequest>(({ input }) => run(input)) } }))
    actor.start()
    return actor
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))

  it('walks Needs you, then Ready, to Inbox zero, advancing after each action', async () => {
    const ran: TriageRequest[] = []
    const actor = start(async request => {
      ran.push(request)
    })
    actor.send({ type: 'start', needsYou: ['n1', 'n2'], ready: ['r1'] })
    expect(TriageModel.current(actor.getSnapshot().context)).toBe('n1')
    expect(TriageModel.progress(actor.getSnapshot().context)).toEqual({ index: 1, total: 3 })
    actor.send({ type: 'act', request: { kind: 'done', id: 'n1' } })
    await settle()
    expect(TriageModel.current(actor.getSnapshot().context)).toBe('n2')
    expect(TriageModel.progress(actor.getSnapshot().context)).toEqual({ index: 2, total: 3 })
    actor.send({ type: 'skip' })
    expect(TriageModel.current(actor.getSnapshot().context)).toBe('r1')
    actor.send({ type: 'act', request: { kind: 'snooze', id: 'r1' } })
    await settle()
    expect(actor.getSnapshot().matches('zero')).toBe(true)
    expect(ran.map(request => request.kind)).toEqual(['done', 'snooze'])
    actor.send({ type: 'exit' })
    expect(actor.getSnapshot().matches('list')).toBe(true)
  })

  it('skips items resolved elsewhere and stays on an item whose action failed', async () => {
    const actor = start(async () => {
      throw new Error('refused')
    })
    actor.send({ type: 'start', needsYou: ['a', 'b'], ready: [] })
    actor.send({ type: 'items', open: ['b'] })
    expect(TriageModel.current(actor.getSnapshot().context)).toBe('b')
    actor.send({ type: 'act', request: { kind: 'done', id: 'b' } })
    await settle()
    expect(actor.getSnapshot().matches({ running: 'showing' })).toBe(true)
    expect(actor.getSnapshot().context.error).toBe('refused')
    actor.send({ type: 'items', open: [] })
    expect(actor.getSnapshot().matches('zero')).toBe(true)
  })
})
