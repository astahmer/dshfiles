import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import type { ThreadAttentionChanges, ThreadAttentionSnapshot } from './attention-api.js'
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
  const calls = { state: 0, acknowledge: 0, clearUnreadMany: 0, markUnreadMany: 0 }
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
    clearUnreadMany: async () => {
      calls.clearUnreadMany += 1
      next = snapshot(next.revision + 1)
      return next
    },
    markUnread: async () => next,
    markUnreadMany: async input => {
      calls.markUnreadMany += 1
      next = snapshot(next.revision + 1, input.sessionIds)
      return next
    },
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

  it('reads at once when the Host announces a change, even one that removed a record without a new revision', async () => {
    const { api, calls, setSnapshot } = fakeApi()
    store().attach(api)
    await vi.advanceTimersByTimeAsync(0)
    assert.equal(calls.state, 1)
    setSnapshot(snapshot(1, []))
    store().changed?.(1)
    await vi.advanceTimersByTimeAsync(0)
    assert.equal(calls.state, 2)
    assert.deepEqual(store().getSnapshot().snapshot?.sessions, [])
    store().changed?.(0)
    await vi.advanceTimersByTimeAsync(0)
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

  it('sends bulk read and unread changes through one Host request each', async () => {
    const { api, calls } = fakeApi()
    store().attach(api)
    await vi.advanceTimersByTimeAsync(0)

    await store().markUnreadMany(['thread-a', 'thread-b'])
    await store().clearUnreadMany([
      { sessionId: 'thread-a', version: 1 },
      { sessionId: 'thread-b', version: 2 },
    ])

    assert.equal(calls.markUnreadMany, 1)
    assert.equal(calls.clearUnreadMany, 1)
    assert.equal(calls.state, 1)
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

  it('follows a change with the records changed since its revision instead of the whole state', async () => {
    const { api, calls } = fakeApi()
    const asked: number[] = []
    let answer: ThreadAttentionChanges = { revision: 5, complete: true, put: snapshot(5, ['thread-b']).sessions, removed: ['thread-a'] }
    const delta: AttentionApi = {
      ...api,
      changesSince: async input => {
        asked.push(input.revision)
        return answer
      },
    }
    store().attach(delta)
    await vi.advanceTimersByTimeAsync(0)
    assert.equal(calls.state, 1)

    store().changed?.(5)
    await vi.advanceTimersByTimeAsync(0)
    assert.deepEqual(asked, [1])
    assert.equal(calls.state, 1)
    assert.equal(store().getSnapshot().snapshot?.revision, 5)
    assert.deepEqual(
      store()
        .getSnapshot()
        .snapshot?.sessions.map(view => view.sessionId),
      ['thread-b'],
    )

    answer = { revision: 9, complete: false, put: [], removed: [] }
    store().changed?.(9)
    await vi.advanceTimersByTimeAsync(0)
    assert.deepEqual(asked, [1, 5])
    assert.equal(calls.state, 2)
  })

  it('reads the whole state from a Host that predates changesSince, and stops asking it', async () => {
    const { api, calls } = fakeApi()
    let asked = 0
    const older: AttentionApi = {
      ...api,
      changesSince: async () => {
        asked += 1
        return Promise.reject(new Error('Unknown API method changesSince.'))
      },
    }
    store().attach(older)
    await vi.advanceTimersByTimeAsync(0)
    store().changed?.(2)
    await vi.advanceTimersByTimeAsync(0)
    store().changed?.(3)
    await vi.advanceTimersByTimeAsync(0)
    assert.equal(asked, 1)
    assert.equal(calls.state, 3)
  })

  it('writes through the delta contract when the Host serves it, merging the answer into the held snapshot', async () => {
    const { api, calls } = fakeApi()
    const sent: Array<{ since: number; kind: string }> = []
    const deltaHost: AttentionApi = {
      ...api,
      writeCapabilities: async () => ({ deltaVersion: 1 }),
      writeDelta: async input => {
        sent.push({ since: input.since, kind: input.command.kind })
        return { revision: input.since + 1, complete: true, put: [], removed: ['thread-a'] }
      },
    }
    store().attach(deltaHost)
    await vi.advanceTimersByTimeAsync(0)
    await store().acknowledge('thread-a', 1)
    assert.deepEqual(sent, [{ since: 1, kind: 'acknowledge' }])
    assert.equal(calls.acknowledge, 0)
    assert.deepEqual(store().getSnapshot().snapshot?.sessions, [])
    assert.equal(store().getSnapshot().snapshot?.revision, 2)
  })

  it('writes through the v1 methods when the Host serves no delta contract', async () => {
    const { api, calls } = fakeApi()
    let wrote = 0
    store().attach({
      ...api,
      writeDelta: async () => {
        wrote += 1
        return { revision: 2, complete: true, put: [], removed: [] }
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    await store().acknowledge('thread-a', 1)
    assert.equal(wrote, 0)
    assert.equal(calls.acknowledge, 1)
  })

  it('never replays a failed delta write through the v1 methods', async () => {
    const { api, calls } = fakeApi()
    store().attach({
      ...api,
      writeCapabilities: async () => ({ deltaVersion: 1 }),
      writeDelta: async () => Promise.reject(new Error('could not be reached')),
    })
    await vi.advanceTimersByTimeAsync(0)
    await assert.rejects(store().acknowledge('thread-a', 1))
    assert.equal(calls.acknowledge, 0)
  })

  it('keeps the queue usable after a failed write', async () => {
    const { api, calls } = fakeApi()
    let attempts = 0
    store().attach({
      ...api,
      writeCapabilities: async () => ({ deltaVersion: 1 }),
      writeDelta: async () => {
        attempts += 1
        if (attempts === 1) return Promise.reject(new Error('boom'))
        return { revision: 2, complete: true, put: [], removed: ['thread-a'] }
      },
    })
    await vi.advanceTimersByTimeAsync(0)
    await assert.rejects(store().acknowledge('thread-a', 1))
    await store().acknowledge('thread-a', 1)
    assert.equal(attempts, 2)
    assert.equal(calls.acknowledge, 0)
    assert.deepEqual(store().getSnapshot().snapshot?.sessions, [])
  })
})
