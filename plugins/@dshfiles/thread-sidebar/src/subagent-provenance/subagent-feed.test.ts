import type { SessionEventLikeEntry, SessionEventSource, SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSubagentFeedStore, SubagentFeedModel } from './subagent-feed.js'

// SAFETY: fixture events carry only what the fold reads.
const entry = <Data>(type: string, data: Data): SessionEventLikeEntry =>
  ({ type: 'event', event: { type, data, seq: 1, time: 1 } }) as unknown as SessionEventLikeEntry
const chunk = (text: string) => entry('assistant/live-chunk', { chunk: { type: 'text-delta', index: 0, text } })

const source = (initial: readonly SessionEventLikeEntry[] = []) => {
  let window: SessionEventWindow = { entries: initial, hasMore: false, revision: 0, change: { kind: 'replace', entries: initial } }
  const listeners = new Set<() => void>()
  const eventSource: SessionEventSource = {
    getSnapshot: () => window,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const append = (next: SessionEventLikeEntry): void => {
    window = { ...window, entries: [...window.entries, next], change: { kind: 'append', entries: [next] } }
    for (const listener of listeners) listener()
  }
  return { eventSource, append, listeners }
}

describe('SubagentFeedModel', () => {
  it('reads the child name from a delegation result only', () => {
    expect(SubagentFeedModel.childNameOfResult('started subagent agent-1')).toBe('agent-1')
    expect(SubagentFeedModel.childNameOfResult('Error: no route')).toBeUndefined()
    expect(SubagentFeedModel.childNameOfResult(undefined)).toBeUndefined()
  })

  it('finds the child session behind that name in the parent catalog', () => {
    const catalog = [{ id: 'session-9', name: 'agent-1' }, { id: 'session-8' }]
    expect(SubagentFeedModel.childOf(catalog, 'agent-1')).toBe('session-9')
    // An older result named the session itself.
    expect(SubagentFeedModel.childOf(catalog, 'session-8')).toBe('session-8')
    expect(SubagentFeedModel.childOf(catalog, undefined)).toBeUndefined()
  })

  it('follows the tool the child is in and counts its calls', () => {
    const inTool = SubagentFeedModel.fold(SubagentFeedModel.empty, [entry('tool/call', { name: 'bash' })])
    expect(inTool).toMatchObject({ tool: 'bash', toolCalls: 1 })
    expect(SubagentFeedModel.fold(inTool, [entry('tool/result', {})])).toMatchObject({ tool: undefined, toolCalls: 1 })
  })

  it('streams answer text, then keeps the settled message', () => {
    const live = SubagentFeedModel.fold(SubagentFeedModel.empty, [chunk('Hel'), chunk('lo')])
    expect(live.text).toBe('Hello')
    const settled = SubagentFeedModel.fold(live, [entry('assistant/message', { message: { content: [{ type: 'text', text: 'Hello there' }] } })])
    expect(settled.text).toBe('Hello there')
  })

  it('keeps only the tail of a long answer', () => {
    const feed = SubagentFeedModel.fold(SubagentFeedModel.empty, [chunk('x'.repeat(5_000))])
    expect(feed.text.length).toBe(2_000)
  })

  it('records how the latest turn ended, from the reason DSH writes, and forgets it when another starts (round 21 D4)', () => {
    const endedWith = (reason: object) => SubagentFeedModel.fold(SubagentFeedModel.empty, [entry('turn/end', { turn: 1, reason })]).lastTurnEnd
    const ended = SubagentFeedModel.fold(SubagentFeedModel.empty, [entry('turn/end', { turn: 1, reason: { kind: 'completed' } })])
    expect(ended.lastTurnEnd).toBe('completed')
    expect(SubagentFeedModel.fold(ended, [entry('turn/start', {})]).lastTurnEnd).toBeUndefined()
    // A provider refusal or the output limit is a failure; a stop, a refused gate or a crash is a stop.
    expect(endedWith({ kind: 'error', error: { message: '404 Command Code has no such route', code: 'UNKNOWN' } })).toBe('failed')
    expect(endedWith({ kind: 'max-tokens' })).toBe('failed')
    expect(endedWith({ kind: 'aborted', reason: { kind: 'user' } })).toBe('stopped')
    expect(endedWith({ kind: 'blocked' })).toBe('stopped')
    expect(endedWith({ kind: 'interrupted' })).toBe('stopped')
  })

  it('reads a child\'s terminal state from the list facts every surface holds (round 21 D4)', () => {
    const base = { running: false, failedTurn: false, lastTurnCompleted: undefined }
    expect(SubagentFeedModel.terminalOf({ ...base, lastTurnCompleted: true })).toBe('completed')
    // `subagentTiming` only says the turn did not complete; the Host's failed-turn record says it failed.
    expect(SubagentFeedModel.terminalOf({ ...base, lastTurnCompleted: false, failedTurn: true })).toBe('failed')
    expect(SubagentFeedModel.terminalOf({ ...base, lastTurnCompleted: false })).toBe('stopped')
    expect(SubagentFeedModel.terminalOf({ ...base, failedTurn: true, running: true })).toBeUndefined()
    expect(SubagentFeedModel.terminalOf(base)).toBeUndefined()
  })

  it('ignores events it does not read and malformed payloads', () => {
    const feed = SubagentFeedModel.fold(SubagentFeedModel.empty, [
      entry('step/start', {}),
      entry('tool/call', null),
      entry('assistant/live-chunk', { chunk: 3 }),
    ])
    expect(feed).toBe(SubagentFeedModel.empty)
  })

  it('keeps agent states apart from a started call', () => {
    const base = { phase: 'result' as const, failed: false, childId: 'child', running: false, terminal: undefined }
    expect(SubagentFeedModel.stateOf({ ...base, phase: 'start', childId: undefined })).toBe('starting')
    expect(SubagentFeedModel.stateOf({ ...base, failed: true })).toBe('failed-to-start')
    expect(SubagentFeedModel.stateOf({ ...base, running: true, terminal: 'completed' })).toBe('working')
    expect(SubagentFeedModel.stateOf({ ...base, terminal: 'completed' })).toBe('finished')
    expect(SubagentFeedModel.stateOf({ ...base, terminal: 'failed' })).toBe('failed')
    expect(SubagentFeedModel.stateOf({ ...base, terminal: 'stopped' })).toBe('interrupted')
  })
})

describe('createSubagentFeedStore', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('repaints on a timer rather than per token', () => {
    const child = source()
    const store = createSubagentFeedStore(child.eventSource, 150)
    const listener = vi.fn()
    store.subscribe(listener)
    for (const token of ['a', 'b', 'c', 'd']) child.append(chunk(token))
    expect(listener).not.toHaveBeenCalled()
    expect(store.getSnapshot().text).toBe('')
    vi.advanceTimersByTime(150)
    expect(listener).toHaveBeenCalledOnce()
    expect(store.getSnapshot().text).toBe('abcd')
  })

  it('starts from the window it opens on', () => {
    const child = source([entry('tool/call', { name: 'read' })])
    expect(createSubagentFeedStore(child.eventSource).getSnapshot()).toMatchObject({ tool: 'read', toolCalls: 1 })
  })

  it('stops following on dispose', () => {
    const child = source()
    const store = createSubagentFeedStore(child.eventSource, 150)
    const listener = vi.fn()
    store.subscribe(listener)
    child.append(chunk('a'))
    store.dispose()
    vi.advanceTimersByTime(300)
    expect(listener).not.toHaveBeenCalled()
    expect(child.listeners.size).toBe(0)
  })
})
