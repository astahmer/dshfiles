import { describe, expect, it } from 'vitest'
import { indexRebasedThreadSessions, type RebasedSessionState, type RebasedThread } from './rebased-threads.js'

const session = (id: string, overrides: Partial<RebasedSessionState> = {}): RebasedSessionState => ({
  id,
  running: false,
  pendingInteraction: false,
  updatedAt: 0,
  ...overrides,
})

const thread = (overrides: Partial<RebasedThread> = {}): RebasedThread => ({
  sessionIds: ['session-a'],
  rebasedAt: 1_000,
  unlanded: [],
  ...overrides,
})

describe('indexRebasedThreadSessions', () => {
  it('marks cleanly rebased sessions and returns only safe sessions after the configured delay', () => {
    const result = indexRebasedThreadSessions({
      threads: [thread({ sessionIds: ['session-a'] }), thread({ sessionIds: ['session-b'], rebasedAt: 1_000 })],
      sessions: new Map([
        ['session-a', session('session-a')],
        ['session-b', session('session-b', { running: true })],
      ]),
      archivedSessionIds: new Set(),
      settledSessionIds: new Set(),
      pinnedSessionIds: new Set(),
      now: 61_000,
      delayMs: 60_000,
    })

    expect(result.rebasedAtBySessionId).toEqual(
      new Map([
        ['session-a', 1_000],
        ['session-b', 1_000],
      ]),
    )
    expect(result.dueSessionIds).toEqual(['session-a'])
  })

  it('keeps the rebased marker visible without auto-settling newer unlanded work', () => {
    const result = indexRebasedThreadSessions({
      threads: [thread({ unlanded: [{ commitId: 'new-work' }] })],
      sessions: new Map([['session-a', session('session-a')]]),
      archivedSessionIds: new Set(),
      settledSessionIds: new Set(),
      pinnedSessionIds: new Set(),
      now: 100_000,
      delayMs: 0,
    })

    expect(result.rebasedAtBySessionId).toEqual(new Map([['session-a', 1_000]]))
    expect(result.dueSessionIds).toEqual([])
  })

  it('does not auto-settle threads with new work after their last rebase', () => {
    const result = indexRebasedThreadSessions({
      threads: [thread({ unlanded: [{ commitId: 'new-work' }] })],
      sessions: new Map([['session-a', session('session-a')]]),
      archivedSessionIds: new Set(),
      settledSessionIds: new Set(),
      pinnedSessionIds: new Set(),
      now: 100_000,
      delayMs: 0,
    })

    expect(result.rebasedAtBySessionId).toEqual(new Map([['session-a', 1_000]]))
    expect(result.dueSessionIds).toEqual([])
  })

  it('waits for pending interactions and skips archived or pinned sessions', () => {
    const result = indexRebasedThreadSessions({
      threads: [thread({ sessionIds: ['pending', 'unknown', 'archived', 'pinned'] })],
      sessions: new Map([
        ['pending', session('pending', { pendingInteraction: true })],
        ['unknown', session('unknown', { pendingInteraction: undefined })],
        ['archived', session('archived')],
        ['pinned', session('pinned')],
      ]),
      archivedSessionIds: new Set(['archived']),
      settledSessionIds: new Set(),
      pinnedSessionIds: new Set(['pinned']),
      now: 1_000,
      delayMs: 0,
    })

    expect(result.dueSessionIds).toEqual([])
  })

  it('leaves a thread alone when conversation activity happened after the rebase', () => {
    const result = indexRebasedThreadSessions({
      threads: [thread()],
      sessions: new Map([['session-a', session('session-a', { updatedAt: 1_001 })]]),
      archivedSessionIds: new Set(),
      settledSessionIds: new Set(),
      pinnedSessionIds: new Set(),
      now: 1_000,
      delayMs: 0,
    })

    expect(result.dueSessionIds).toEqual([])
  })

  it('archives remaining members when another member of the rebased thread is already archived', () => {
    const result = indexRebasedThreadSessions({
      threads: [thread({ sessionIds: ['session-a', 'session-b'] })],
      sessions: new Map([
        ['session-a', session('session-a')],
        ['session-b', session('session-b')],
      ]),
      archivedSessionIds: new Set(['session-a']),
      settledSessionIds: new Set(),
      pinnedSessionIds: new Set(),
      now: 1_000,
      delayMs: 0,
    })

    expect(result.dueSessionIds).toEqual(['session-b'])
  })

  it('does not archive before the rebased timestamp plus the delay', () => {
    const result = indexRebasedThreadSessions({
      threads: [thread()],
      sessions: new Map([['session-a', session('session-a')]]),
      archivedSessionIds: new Set(),
      settledSessionIds: new Set(),
      pinnedSessionIds: new Set(),
      now: 60_999,
      delayMs: 60_000,
    })

    expect(result.dueSessionIds).toEqual([])
  })
})
