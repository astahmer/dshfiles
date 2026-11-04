import { describe, expect, test } from 'vitest'
import { RemoteDelegation } from '../src/remote-delegation.js'

const user = (seq: number, text = 'do it') => ({ seq, kind: 'user' as const, text })
const assistant = (seq: number, text: string) => ({ seq, kind: 'assistant' as const, text })

describe('remote delegation progress', () => {
  test('keeps working while the turn runs or before it started', () => {
    expect(RemoteDelegation.progressOf({ entries: [user(1)], running: true })).toEqual({ state: 'working' })
    expect(RemoteDelegation.progressOf({ entries: [user(1)], running: false })).toEqual({ state: 'working' })
    expect(RemoteDelegation.progressOf({ entries: [], running: false })).toEqual({ state: 'working' })
  })

  test('finishes with the last assistant text after the last prompt', () => {
    const entries = [
      user(1, 'old'),
      assistant(2, 'old answer'),
      user(3),
      { seq: 4, kind: 'tool' as const, text: 'bash' },
      assistant(5, 'first'),
      assistant(6, 'done: 3 files'),
    ]
    expect(RemoteDelegation.progressOf({ entries, running: false })).toEqual({ state: 'finished', answer: 'done: 3 files' })
  })

  test('an answer from an earlier prompt does not finish the new one', () => {
    expect(RemoteDelegation.progressOf({ entries: [user(1, 'old'), assistant(2, 'old answer'), user(3)], running: false })).toEqual({ state: 'working' })
  })

  test('reports a failed turn and a pending question', () => {
    expect(RemoteDelegation.progressOf({ entries: [user(1), { seq: 2, kind: 'status', text: 'This turn failed' }], running: false })).toEqual({
      state: 'failed',
      detail: 'This turn failed',
    })
    const waiting = { kind: 'question' as const, tool: 'ask_user_question', since: 10 }
    expect(RemoteDelegation.progressOf({ entries: [user(1)], running: true, waiting })).toEqual({ state: 'waiting', waiting })
  })
})
