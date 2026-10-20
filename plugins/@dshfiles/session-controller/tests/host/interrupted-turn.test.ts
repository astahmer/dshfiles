import { expect, it } from 'vitest'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { latestInterruptedTurn } from '../../src/interrupted-turn.ts'

const interrupted = (seq: number, turn: number): SessionEvent => ({
  type: 'turn/end', seq: SessionSeq(seq), time: 100, data: { turn, reason: { kind: 'interrupted' } },
})

it('offers only the latest interrupted task and preserves its exact end identity', () => {
  expect(latestInterruptedTurn([])).toBeUndefined()
  expect(latestInterruptedTurn([interrupted(3, 1), interrupted(8, 2)])).toBe(8)
})

it('rejects a stopped task after another turn starts or completes', () => {
  const events: SessionEvent[] = [interrupted(3, 1)]
  events.push({ type: 'turn/start', seq: SessionSeq(4), time: 200, data: { turn: 2 } })
  expect(latestInterruptedTurn(events)).toBeUndefined()
  events.push({ type: 'turn/end', seq: SessionSeq(5), time: 300, data: { turn: 2, reason: { kind: 'completed' } } })
  expect(latestInterruptedTurn(events)).toBeUndefined()
})

it('does not resume other terminal failures or signed-out tasks', () => {
  const events: SessionEvent[] = [interrupted(3, 1), {
    type: 'turn/end', seq: SessionSeq(5), time: 300,
    data: { turn: 2, reason: { kind: 'error', error: { message: 'Sign in', code: 'ACCOUNT_SIGNED_OUT' } } },
  }]
  expect(latestInterruptedTurn(events)).toBeUndefined()
})
