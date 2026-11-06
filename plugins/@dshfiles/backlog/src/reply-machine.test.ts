import { expect, it } from 'vitest'
import { createActor, waitFor } from '@dshfiles/plugin-ui/machine'

import type { AgentContinuationSelection, AgentDispatchOutcome } from './agent-dispatch.js'
import { createReplyMachine, type ContinuationRequest, type ReplyPorts } from './reply-machine.js'

const request: ContinuationRequest = {
  agent: { handle: 'reviewer', name: 'Reviewer', glyph: 'R', description: '' },
  threads: [{ sessionId: 'session-1', title: 'Earlier review' }],
}

/**
 * The backlog reply box's dispatch closes over a continuation question the machine answers; this is that same
 * adaption, so the machine is driven exactly as the component drives it.
 */
const setup = () => {
  const machine = createReplyMachine<{ readonly name: string }>()
  const actor = createActor(machine).start()
  const failures: string[] = []
  const saves: number[] = []
  let selection: AgentContinuationSelection | null = null
  const ports: ReplyPorts<{ readonly name: string }> = {
    save: async () => {
      saves.push(saves.length + 1)
    },
    dispatch: {
      dispatch: async () => {
        selection = await new Promise<AgentContinuationSelection>(resolve => actor.send({ type: 'CONTINUATION_REQUEST', request, resolve }))
        const outcome: AgentDispatchOutcome = { kind: 'skipped', reason: 'continuation-cancelled' }
        return outcome
      },
      answerReply: async () => ({ ok: true }),
      smartReplyAnswers: false,
    },
    clear: () => {},
    restore: () => {},
    reportFailure: message => {
      failures.push(message)
    },
    onAnswering: undefined,
  }
  const submit = () => actor.send({ type: 'SUBMIT', text: '@reviewer look', files: [], ports })
  return { actor, failures, saves, submit, selection: () => selection }
}

it('holds the continuation question inside the dispatch it belongs to', async () => {
  const { actor, submit, selection } = setup()
  submit()
  await waitFor(actor, snapshot => snapshot.context.continuation !== null)
  expect(actor.getSnapshot().value).toBe('dispatching')
  expect(actor.getSnapshot().context.continuation?.request).toEqual(request)

  actor.send({ type: 'CONTINUE', selection: { kind: 'new' } })
  await waitFor(actor, snapshot => snapshot.value === 'idle')
  expect(selection()).toEqual({ kind: 'new' })
  expect(actor.getSnapshot().context.continuation).toBeNull()
})

it('answers a cancelled continuation once and keeps the saved reply', async () => {
  const { actor, failures, submit, selection } = setup()
  submit()
  await waitFor(actor, snapshot => snapshot.context.continuation !== null)

  actor.send({ type: 'CANCEL_CONTINUATION' })
  await waitFor(actor, snapshot => snapshot.value === 'idle')

  expect(selection()).toEqual({ kind: 'cancel' })
  expect(actor.getSnapshot().context.continuation).toBeNull()
  expect(failures).toEqual(['Comment saved; no thread was started.'])
})

it('ignores a second submit while the first one is still dispatching', async () => {
  const { actor, saves, submit } = setup()
  submit()
  await waitFor(actor, snapshot => snapshot.context.continuation !== null)
  submit()

  expect(saves).toEqual([1])
  expect(actor.getSnapshot().value).toBe('dispatching')
})
