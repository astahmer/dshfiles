import { expect, it } from 'vitest'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { latestInterruptedTurn } from '../../src/interrupted-turn.ts'

const interrupted = (seq: number, turn: number): SessionEvent => ({
  type: 'turn/end',
  seq: SessionSeq(seq),
  time: 100,
  data: { turn, reason: { kind: 'interrupted' } },
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

it('keeps offering a stopped task when a later message never started a turn', () => {
  const userMessage = (seq: number): SessionEvent =>
    // SAFETY: latestInterruptedTurn reads only the type and seq of a trailing user message.
    ({ type: 'user/message', seq: SessionSeq(seq), time: 200, data: {} }) as never
  expect(latestInterruptedTurn([interrupted(3, 1), userMessage(4)])).toBe(3)
  expect(latestInterruptedTurn([interrupted(3, 1), userMessage(4), interrupted(8, 2)])).toBe(8)
})

const failed = (seq: number, code: string): SessionEvent => ({
  type: 'turn/end',
  seq: SessionSeq(seq),
  time: 300,
  data: { turn: 2, reason: { kind: 'error', error: { message: 'failed', code } } },
})

it('offers a task a model request failure stopped', () => {
  expect(latestInterruptedTurn([interrupted(3, 1), failed(5, 'RATE_LIMIT')])).toBe(5)
  expect(latestInterruptedTurn([failed(5, 'SERVER')])).toBe(5)
})

it('does not resume a signed-out task', () => {
  expect(latestInterruptedTurn([interrupted(3, 1), failed(5, 'ACCOUNT_SIGNED_OUT')])).toBeUndefined()
})

it('does not resume a completed task', () => {
  const completed: SessionEvent = { type: 'turn/end', seq: SessionSeq(5), time: 300, data: { turn: 2, reason: { kind: 'completed' } } }
  expect(latestInterruptedTurn([interrupted(3, 1), completed])).toBeUndefined()
})

it('offers a task the Host shutdown cut off, but not one the user stopped', () => {
  const aborted = (seq: number, cause: 'disposed' | 'user'): SessionEvent => ({
    type: 'turn/end',
    seq: SessionSeq(seq),
    time: 300,
    data: { turn: 2, reason: { kind: 'aborted', reason: { kind: cause } } },
  })
  expect(latestInterruptedTurn([aborted(5, 'disposed')])).toBe(5)
  expect(latestInterruptedTurn([aborted(5, 'user')])).toBeUndefined()
})

it('offers a task the output-token cap cut off', () => {
  const capped: SessionEvent = { type: 'turn/end', seq: SessionSeq(5), time: 300, data: { turn: 2, reason: { kind: 'max-tokens' } } }
  expect(latestInterruptedTurn([interrupted(3, 1), capped])).toBe(5)
  expect(latestInterruptedTurn([capped, { type: 'turn/start', seq: SessionSeq(6), time: 400, data: { turn: 3 } }])).toBeUndefined()
})
