import { expect, it } from 'vitest'
import { SessionSeq, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session/types'
import { latestInterruptedTurn, latestStoppedTurn } from '../../src/interrupted-turn.ts'

const marker = (seq: number, type: string): SessionEvent =>
  // SAFETY: the stopped-turn scan reads only the type and seq of these events.
  ({ type, seq: SessionSeq(seq), time: 200, data: {} }) as never

const ended = (seq: number, reason: TurnEndReason): SessionEvent => ({ type: 'turn/end', seq: SessionSeq(seq), time: 300, data: { turn: 2, reason } })

/** A turn that started answering before it stopped. */
const answered = (start: number, reason: TurnEndReason): SessionEvent[] => [
  marker(start, 'turn/start'),
  marker(start + 1, 'assistant/message'),
  ended(start + 2, reason),
]
/** A turn whose only model request failed: an attempt, never an assistant message. */
const unanswered = (start: number, reason: TurnEndReason): SessionEvent[] => [
  marker(start, 'turn/start'),
  marker(start + 1, 'user/message'),
  marker(start + 2, 'assistant/attempt'),
  ended(start + 3, reason),
]

const interrupted: TurnEndReason = { kind: 'interrupted' }
const failed = (code: string): TurnEndReason => ({ kind: 'error', error: { message: 'failed', code } })

it('offers only the latest interrupted task and preserves its exact end identity', () => {
  expect(latestInterruptedTurn([])).toBeUndefined()
  expect(latestInterruptedTurn([...answered(0, interrupted), ...answered(3, interrupted)])).toBe(5)
})

it('rejects a stopped task after another turn starts or completes', () => {
  const events: SessionEvent[] = answered(0, interrupted)
  events.push(marker(3, 'turn/start'))
  expect(latestStoppedTurn(events)).toBeUndefined()
  events.push(ended(4, { kind: 'completed' }))
  expect(latestStoppedTurn(events)).toBeUndefined()
})

it('keeps offering a stopped task when a later message never started a turn', () => {
  expect(latestInterruptedTurn([...answered(0, interrupted), marker(3, 'user/message')])).toBe(2)
  expect(latestStoppedTurn([...unanswered(0, failed('PI_AI_ERROR')), marker(4, 'user/message')])).toEqual({ seq: 3, action: 'retry' })
})

it('resumes a task a model request failure stopped after it started answering', () => {
  expect(latestStoppedTurn(answered(0, failed('RATE_LIMIT')))).toEqual({ seq: 2, action: 'resume' })
  expect(latestStoppedTurn([marker(0, 'turn/start'), marker(1, 'tool/call'), ended(2, failed('SERVER'))])).toEqual({ seq: 2, action: 'resume' })
})

it('retries, instead of resuming, a task whose request failed before any reply', () => {
  expect(latestStoppedTurn(unanswered(0, failed('PI_AI_ERROR')))).toEqual({ seq: 3, action: 'retry' })
  expect(latestStoppedTurn(unanswered(0, interrupted))).toEqual({ seq: 3, action: 'retry' })
  expect(latestStoppedTurn(unanswered(0, { kind: 'aborted', reason: { kind: 'disposed' } }))).toEqual({ seq: 3, action: 'retry' })
  expect(latestInterruptedTurn(unanswered(0, failed('PI_AI_ERROR')))).toBeUndefined()
})

it('retries a signed-out task that produced nothing once the account signs in, but never resumes one', () => {
  expect(latestStoppedTurn(unanswered(0, failed('ACCOUNT_SIGNED_OUT')))).toEqual({ seq: 3, action: 'retry' })
  expect(latestStoppedTurn(answered(0, failed('ACCOUNT_SIGNED_OUT')))).toBeUndefined()
})

it('does not offer a completed task', () => {
  expect(latestStoppedTurn(answered(0, { kind: 'completed' }))).toBeUndefined()
  expect(latestStoppedTurn(unanswered(0, { kind: 'completed' }))).toBeUndefined()
})

it('offers a task the Host shutdown cut off, but not one the user stopped', () => {
  expect(latestStoppedTurn(answered(0, { kind: 'aborted', reason: { kind: 'disposed' } }))).toEqual({ seq: 2, action: 'resume' })
  expect(latestStoppedTurn(answered(0, { kind: 'aborted', reason: { kind: 'user' } }))).toBeUndefined()
  expect(latestStoppedTurn(unanswered(0, { kind: 'aborted', reason: { kind: 'user' } }))).toBeUndefined()
})

it('resumes a task the output-token cap cut off', () => {
  expect(latestStoppedTurn(answered(0, { kind: 'max-tokens' }))).toEqual({ seq: 2, action: 'resume' })
  expect(latestStoppedTurn([...answered(0, { kind: 'max-tokens' }), marker(3, 'turn/start')])).toBeUndefined()
})
