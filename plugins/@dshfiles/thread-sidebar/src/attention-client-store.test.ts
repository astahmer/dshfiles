import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import type { ThreadAttentionSnapshot } from './attention-api.js'
import { sharedThreadAttentionStore, type AttentionApi } from './attention-client-store.js'

const snapshot = (revision: number, sessionIds: readonly string[] = []): ThreadAttentionSnapshot => ({
  revision,
  sessions: sessionIds.map((sessionId, index) => ({
    sessionId,
    version: index + 1,
    finishedAt: null,
    finishedSeq: null,
    finishedReason: null,
    manuallyUnread: true,
  })),
})

const fakeApi = () => {
  const calls = { state: 0, acknowledge: 0 }
  let next = snapshot(1, ['thread-a'])
  const api: AttentionApi = {
    state: async () => {
      calls.state += 1
      return next
    },
    acknowledge: async () => {
      calls.acknowledge += 1
      next = snapshot(next.revision + 1, [])
      return next
    },
    clearUnread: async () => next,
    markUnread: async () => next,
    migrate: async () => next,
  }
  return { api, calls, setSnapshot: (value: ThreadAttentionSnapshot) => (next = value) }
}

const store = () => sharedThreadAttentionStore()

describe('shared thread attention store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    store().reset()
  })
  afterEach(() => {
    store().reset()
    vi.useRealTimers()
  })

  it('shares one Host read across every mounted surface', async () => {
    const { api, calls } = fakeApi()
    const detachFirst = store().attach(api)
    const detachSecond = store().attach(api)
    await vi.advanceTimersByTimeAsync(0)
    assert.equal(calls.state, 1)
    detachFirst()
    detachSecond()
  })

  it('polls once per interval instead of once per surface', async () => {
    const { api, calls } = fakeApi()
    store().attach(api)
    store().attach(api)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(30_000)
    assert.equal(calls.state, 2)
  })

  it('adopts the snapshot a write returns without a follow-up read', async () => {
    const { api, calls } = fakeApi()
    store().attach(api)
    await vi.advanceTimersByTimeAsync(0)
    await store().acknowledge('thread-a', 1)
    assert.equal(calls.acknowledge, 1)
    assert.equal(calls.state, 1)
    assert.deepEqual(
      store()
        .getSnapshot()
        .snapshot?.sessions.map(view => view.sessionId),
      [],
    )
  })

  it('keeps the last snapshot when a read fails and retries on the next poll', async () => {
    const { api } = fakeApi()
    store().attach(api)
    await vi.advanceTimersByTimeAsync(0)
    let failedReads = 0
    const failing: AttentionApi = {
      ...api,
      state: async () => {
        failedReads += 1
        return Promise.reject(new Error('boom'))
      },
    }
    store().attach(failing)
    await vi.advanceTimersByTimeAsync(30_000)
    assert.equal(failedReads, 1)
    assert.equal(store().getSnapshot().snapshot?.revision, 1)
  })
})
