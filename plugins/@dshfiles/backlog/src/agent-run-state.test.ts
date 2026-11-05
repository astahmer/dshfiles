import { describe, expect, it } from 'vitest'
import { AgentRunStates, type FinishReason, type RunStateThread } from './agent-run-state.js'

const NOW = 10_000_000
const threads = (...rows: RunStateThread[]): ReadonlyMap<string, RunStateThread> => new Map(rows.map(row => [row.id, row]))
const finished = (entries: Record<string, FinishReason>): ReadonlyMap<string, FinishReason> => new Map(Object.entries(entries))
const open = { status: 'doing', delegate: 'agent:session-a', links: [] } as const

describe('agent run state', () => {
  it('follows the delegate thread: working, awaiting input, error, done, stale', () => {
    const live = threads({ id: 'session-a', running: true, updatedAt: NOW })
    expect(AgentRunStates.of({ item: open, threads: live, finished: new Map(), now: NOW })?.state).toBe('working')
    const idle = threads({ id: 'session-a', running: false, updatedAt: NOW - 1_000 })
    expect(AgentRunStates.of({ item: open, threads: idle, finished: finished({ 'session-a': 'blocked' }), now: NOW })?.state).toBe('awaiting-input')
    expect(AgentRunStates.of({ item: open, threads: idle, finished: finished({ 'session-a': 'error' }), now: NOW })?.state).toBe('error')
    expect(AgentRunStates.of({ item: open, threads: idle, finished: finished({ 'session-a': 'completed' }), now: NOW })?.state).toBe('done')
    const old = threads({ id: 'session-a', running: false, updatedAt: NOW - AgentRunStates.staleAfterMs - 1 })
    expect(AgentRunStates.of({ item: open, threads: old, finished: new Map(), now: NOW })?.state).toBe('stale')
  })

  it('falls back to the most recently active linked thread and shows nothing for closed items or unknown threads', () => {
    const item = {
      status: 'todo',
      delegate: null,
      links: [
        { type: 'thread', target: 'session-old' },
        { type: 'thread', target: 'session-new' },
      ],
    } as const
    const rows = threads({ id: 'session-old', running: true, updatedAt: 1 }, { id: 'session-new', running: false, updatedAt: NOW })
    expect(AgentRunStates.of({ item, threads: rows, finished: new Map(), now: NOW })).toEqual({ sessionId: 'session-new', state: 'done' })
    expect(AgentRunStates.of({ item: { ...item, status: 'done' }, threads: rows, finished: new Map(), now: NOW })).toBeNull()
    expect(AgentRunStates.of({ item: open, threads: new Map(), finished: new Map(), now: NOW })).toBeNull()
  })
})
