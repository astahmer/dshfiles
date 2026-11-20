import { describe, expect, it, vi } from 'vitest'
import { RunningThreads } from './running-threads.js'

const row = (owner: string | null) => ({ owner })

describe('threads with a running job', () => {
  it('names each owning thread once, in board order, and skips jobs no thread owns', () => {
    expect(RunningThreads.ownersOf({ rows: [row('session-b'), row(null), row('session-a'), row('session-b')] })).toEqual(['session-b', 'session-a'])
    expect(RunningThreads.ownersOf({ rows: [] })).toEqual([])
  })
  it('reads only what runs now, and forwards the signal', async () => {
    const board = vi.fn(async () => ({ rows: [row('session-a')] }))
    const signal = new AbortController().signal
    await expect(RunningThreads.read({ board }, signal)).resolves.toEqual(['session-a'])
    expect(board).toHaveBeenCalledWith({ scope: 'running', limit: RunningThreads.limit }, { signal })
  })
})
