import { describe, expect, it } from 'vitest'
import { TurnAdmissionQueue, type HeldPrompt, type TurnAdmissionSnapshot } from '../src/turn-admission.ts'

const harness = () => {
  const started: string[] = []
  const snapshots: TurnAdmissionSnapshot[] = []
  const state = { threads: 0, subagents: 0, started, pending: new Set<string>(), snapshots }
  const queue = new TurnAdmissionQueue({
    running: countSubagents => state.threads + (countSubagents ? state.subagents : 0),
    release: held => {
      if (!state.pending.delete(held.messageId)) return false
      state.started.push(held.messageId)
      state.threads += 1
      return true
    },
    changed: snapshot => {
      state.snapshots.push(snapshot)
    },
  })
  const park = (sessionId: string, messageId: string, heldAt = 0): HeldPrompt => {
    const held: HeldPrompt = { sessionId, messageId, mode: 'followup', heldAt }
    state.pending.add(messageId)
    queue.hold(held)
    return held
  }
  return { state, queue, park }
}

describe('TurnAdmissionQueue', () => {
  it('never holds with the default unlimited policy', () => {
    const { state, queue } = harness()
    state.threads = 50
    expect(queue.shouldHold()).toBe(false)
  })

  it('holds a new turn once the cap is reached and starts it when a turn ends', () => {
    const { state, queue, park } = harness()
    queue.configure({ maxRunningThreads: 2, countSubagents: false })
    state.threads = 2
    expect(queue.shouldHold()).toBe(true)
    park('a', 'a1')
    expect(queue.snapshot().waiting).toEqual([{ sessionId: 'a', heldAt: 0, ahead: 0 }])
    queue.pump()
    expect(state.started).toEqual([])
    state.threads = 1
    queue.pump()
    expect(state.started).toEqual(['a1'])
    expect(queue.snapshot().waiting).toEqual([])
  })

  it('releases strictly first in, first out, and keeps later prompts behind earlier ones', () => {
    const { state, queue, park } = harness()
    queue.configure({ maxRunningThreads: 1, countSubagents: false })
    state.threads = 1
    park('a', 'a1')
    park('b', 'b1')
    state.threads = 0
    expect(queue.shouldHold()).toBe(true)
    park('c', 'c1')
    expect(queue.snapshot().waiting.map(held => [held.sessionId, held.ahead])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ])
    queue.pump()
    expect(state.started).toEqual(['a1'])
    state.threads = 0
    queue.pump()
    expect(state.started).toEqual(['a1', 'b1'])
  })

  it('counts running subagents only when the policy says so', () => {
    const { state, queue } = harness()
    state.threads = 1
    state.subagents = 3
    queue.configure({ maxRunningThreads: 2, countSubagents: false })
    expect(queue.shouldHold()).toBe(false)
    queue.configure({ maxRunningThreads: 2, countSubagents: true })
    expect(queue.shouldHold()).toBe(true)
  })

  it('force-starts one thread past the cap and leaves the others waiting', () => {
    const { state, queue, park } = harness()
    queue.configure({ maxRunningThreads: 1, countSubagents: false })
    state.threads = 1
    park('a', 'a1')
    park('b', 'b1')
    expect(queue.forceStart('b')).toBe(1)
    expect(state.started).toEqual(['b1'])
    expect(queue.snapshot().waiting.map(held => held.sessionId)).toEqual(['a'])
    expect(queue.forceStart('missing')).toBe(0)
  })

  it('skips a prompt that left the inbox and releases the next one in its slot', () => {
    const { state, queue, park } = harness()
    queue.configure({ maxRunningThreads: 1, countSubagents: false })
    state.threads = 1
    park('a', 'a1')
    park('b', 'b1')
    state.pending.delete('a1')
    state.threads = 0
    queue.pump()
    expect(state.started).toEqual(['b1'])
  })

  it('raising the cap or turning it off releases waiting prompts at once', () => {
    const { state, queue, park } = harness()
    queue.configure({ maxRunningThreads: 1, countSubagents: false })
    state.threads = 1
    park('a', 'a1')
    park('b', 'b1')
    queue.configure({ maxRunningThreads: 0, countSubagents: false })
    expect(state.started).toEqual(['a1', 'b1'])
  })

  it('drops a thread whose Agent left', () => {
    const { state, queue, park } = harness()
    queue.configure({ maxRunningThreads: 1, countSubagents: false })
    state.threads = 1
    park('a', 'a1')
    queue.drop('a')
    expect(queue.snapshot().waiting).toEqual([])
  })
})
