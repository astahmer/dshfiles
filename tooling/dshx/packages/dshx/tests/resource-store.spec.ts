import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResourceStoreModel, type ResourceInvalidationSource } from '../src/api/resource-store.js'
import type { JsonValue } from '../src/json.js'

interface Deferred {
  readonly signal: AbortSignal
  readonly resolve: (value: JsonValue) => void
  readonly reject: (error: unknown) => void
}

/** A fetch whose calls stay pending until the test settles them, so in-flight states are observable. */
const deferredFetch = () => {
  const calls: Deferred[] = []
  const fetch = vi.fn(
    (signal: AbortSignal) =>
      new Promise<unknown>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        calls.push({ signal, resolve, reject })
      }),
  )
  return { calls, fetch }
}

/** A fetch that answers at once with a counter, for poll-cadence tests. */
const countingFetch = () => {
  let reads = 0
  return vi.fn(async () => {
    reads += 1
    return reads
  })
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

const fakeDocument = () => {
  const listeners: Array<() => void> = []
  const document = {
    visibilityState: 'visible',
    addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
  }
  return {
    document,
    setHidden: (hidden: boolean) => {
      document.visibilityState = hidden ? 'hidden' : 'visible'
      for (const listener of listeners) listener()
    },
  }
}

const fakeConnection = () => {
  let generation: number | undefined = 1
  const listeners = new Set<() => void>()
  return {
    connection: {
      identity: {},
      generation: () => generation,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    setGeneration: (next: number | undefined) => {
      generation = next
      for (const listener of [...listeners]) listener()
    },
  }
}

describe('ResourceStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reads once for every subscriber of a key and shares the snapshot', async () => {
    const store = ResourceStoreModel.create()
    const source = deferredFetch()
    const key = store.register({ key: 'board', fetch: source.fetch })
    const first = vi.fn()
    const second = vi.fn()
    store.subscribe(key, first)
    store.subscribe(key, second)
    expect(source.fetch).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot(key)).toMatchObject({ status: 'pending', fetching: true })
    source.calls[0]?.resolve({ rows: 1 })
    await flush()
    expect(store.getSnapshot(key)).toMatchObject({ status: 'success', data: { rows: 1 }, fetching: false })
    expect(first).toHaveBeenCalled()
    expect(second).toHaveBeenCalled()
  })

  it('returns the same snapshot object until the key changes', async () => {
    const store = ResourceStoreModel.create()
    const key = store.register({ key: 'board', fetch: async () => 'a', staleTime: 60_000 })
    expect(store.getSnapshot(key)).toBe(store.getSnapshot('never-registered'))
    store.subscribe(key, () => undefined)
    await flush()
    const settled = store.getSnapshot(key)
    expect(store.getSnapshot(key)).toBe(settled)
    store.subscribe(key, () => undefined)
    expect(store.getSnapshot(key)).toBe(settled)
  })

  it('reuses a fresh read for a new subscriber and re-reads a stale one', async () => {
    const store = ResourceStoreModel.create()
    const fetch = countingFetch()
    const key = store.register({ key: 'board', fetch, staleTime: 10_000 })
    store.subscribe(key, () => undefined)()
    await flush()
    store.subscribe(key, () => undefined)()
    expect(fetch).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10_000)
    store.subscribe(key, () => undefined)
    await flush()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('polls on one timer per key and stops when the last subscriber leaves', async () => {
    const store = ResourceStoreModel.create()
    const fetch = countingFetch()
    const key = store.register({ key: 'board', fetch, pollInterval: 1_000 })
    const left = store.subscribe(key, () => undefined)
    const right = store.subscribe(key, () => undefined)
    await flush()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(1)
    left()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetch).toHaveBeenCalledTimes(5)
    right()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it('polls at the shortest interval a visible subscriber asks for', async () => {
    const store = ResourceStoreModel.create()
    const fetch = countingFetch()
    const key = store.register({ key: 'list', fetch, pollInterval: 60_000, staleTime: 60_000 })
    store.subscribe(key, () => undefined)
    await flush()
    const popover = store.subscribe(key, () => undefined, { pollInterval: 4_000 })
    await vi.advanceTimersByTimeAsync(8_000)
    expect(fetch).toHaveBeenCalledTimes(3)
    popover.update({ pollInterval: undefined })
    await vi.advanceTimersByTimeAsync(50_000)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('never reads for a hidden subscriber and reads once when it is revealed', async () => {
    const store = ResourceStoreModel.create()
    const fetch = countingFetch()
    const key = store.register({ key: 'board', fetch, pollInterval: 1_000 })
    const panel = store.subscribe(key, () => undefined, { visible: false })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetch).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    panel.update({ visible: true })
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetch).toHaveBeenCalledTimes(2)
    panel.update({ visible: false })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('pauses the poll while the document is hidden and re-reads a stale key when it is shown', async () => {
    const page = fakeDocument()
    vi.stubGlobal('document', page.document)
    const store = ResourceStoreModel.create()
    const fetch = countingFetch()
    const key = store.register({ key: 'board', fetch, pollInterval: 1_000 })
    store.subscribe(key, () => undefined)
    await flush()
    page.setHidden(true)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    page.setHidden(false)
    await flush()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('invalidates by tag: subscribed keys re-read now, others on their next subscriber', async () => {
    const store = ResourceStoreModel.create()
    const watched = countingFetch()
    const unwatched = countingFetch()
    const untagged = countingFetch()
    const watchedKey = store.register({ key: 'revision', fetch: watched, tags: ['revision'], staleTime: 60_000 })
    const unwatchedKey = store.register({ key: 'other', fetch: unwatched, tags: ['revision'], staleTime: 60_000 })
    const untaggedKey = store.register({ key: 'plain', fetch: untagged, staleTime: 60_000 })
    store.subscribe(watchedKey, () => undefined)
    store.subscribe(untaggedKey, () => undefined)
    store.subscribe(unwatchedKey, () => undefined)()
    await flush()
    store.invalidate({ tags: ['revision'] })
    await flush()
    expect(watched).toHaveBeenCalledTimes(2)
    expect(unwatched).toHaveBeenCalledTimes(1)
    expect(untagged).toHaveBeenCalledTimes(1)
    store.subscribe(unwatchedKey, () => undefined)
    await flush()
    expect(unwatched).toHaveBeenCalledTimes(2)
    store.invalidate({ key: untaggedKey })
    await flush()
    expect(untagged).toHaveBeenCalledTimes(2)
  })

  it('keeps the last data on a failed read, rejects ensure and stops polling when asked', async () => {
    const store = ResourceStoreModel.create()
    let fail = false
    const failure = new Error('gone')
    const fetch = vi.fn(async () => {
      if (fail) throw failure
      return 'rows'
    })
    const key = store.register({ key: 'board', fetch, pollInterval: 1_000, shouldPoll: snapshot => snapshot.status !== 'error' })
    store.subscribe(key, () => undefined)
    await flush()
    fail = true
    await vi.advanceTimersByTimeAsync(1_000)
    expect(store.getSnapshot(key)).toMatchObject({ status: 'error', data: 'rows', error: failure, fetching: false })
    expect(vi.getTimerCount()).toBe(0)
    await expect(store.ensure(key)).rejects.toBe(failure)
    fail = false
    await expect(store.ensure(key)).resolves.toBe('rows')
    expect(store.getSnapshot(key).status).toBe('success')
  })

  it('writes data after a mutation and drops an older read still in flight', async () => {
    const store = ResourceStoreModel.create()
    const source = deferredFetch()
    const key = store.register({ key: 'board', fetch: source.fetch })
    store.subscribe(key, () => undefined)
    store.mutate<number>(key, previous => (previous ?? 0) + 5)
    expect(source.calls[0]?.signal.aborted).toBe(true)
    await flush()
    expect(store.getSnapshot(key)).toMatchObject({ status: 'success', data: 5, fetching: false })
  })

  it('drops unsubscribed keys and re-reads subscribed ones on a new Host generation', async () => {
    const store = ResourceStoreModel.create()
    const host = fakeConnection()
    const kept = deferredFetch()
    const dropped = countingFetch()
    const keptKey = store.register({ key: 'kept', fetch: kept.fetch, connection: host.connection, staleTime: 60_000 })
    const droppedKey = store.register({ key: 'dropped', fetch: dropped, connection: host.connection, staleTime: 60_000 })
    store.subscribe(keptKey, () => undefined)
    store.subscribe(droppedKey, () => undefined)()
    kept.calls[0]?.resolve('first')
    await flush()
    expect(store.getSnapshot(droppedKey).status).toBe('success')

    host.setGeneration(undefined)
    expect(vi.getTimerCount()).toBe(0)
    host.setGeneration(2)
    expect(kept.fetch).toHaveBeenCalledTimes(2)
    expect(store.getSnapshot(keptKey)).toMatchObject({ data: 'first', fetching: true })
    expect(store.getSnapshot(droppedKey).status).toBe('idle')
    kept.calls[1]?.resolve('second')
    await flush()
    expect(store.getSnapshot(keptKey).data).toBe('second')
  })

  it('discards a read that started before a generation reset', async () => {
    const store = ResourceStoreModel.create()
    const host = fakeConnection()
    const source = deferredFetch()
    const key = store.register({ key: 'board', fetch: source.fetch, connection: host.connection })
    store.subscribe(key, () => undefined)
    host.setGeneration(2)
    expect(source.calls[0]?.signal.aborted).toBe(true)
    source.calls[1]?.resolve('fresh')
    await flush()
    expect(store.getSnapshot(key).data).toBe('fresh')
  })

  it('re-reads on a push and polls at the live interval while every source is live', async () => {
    const store = ResourceStoreModel.create()
    const fetch = countingFetch()
    const handlers: Array<{ onInvalidate: () => void; onLive: (live: boolean) => void }> = []
    const unsubscribeSource = vi.fn()
    const pushes: ResourceInvalidationSource = {
      id: 'board.changed',
      tags: ['board'],
      subscribe: next => {
        handlers.push(next)
        return unsubscribeSource
      },
    }
    const key = store.register({ key: 'board', fetch, tags: ['board'], pollInterval: 1_000, livePollInterval: 60_000, invalidatedBy: [pushes] })
    const unsubscribe = store.subscribe(key, () => undefined)
    await flush()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetch).toHaveBeenCalledTimes(2)
    handlers[0]?.onLive(true)
    await flush()
    expect(fetch).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetch).toHaveBeenCalledTimes(3)
    handlers[0]?.onInvalidate()
    await flush()
    expect(fetch).toHaveBeenCalledTimes(4)
    handlers[0]?.onLive(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetch).toHaveBeenCalledTimes(5)
    unsubscribe()
    expect(unsubscribeSource).toHaveBeenCalledTimes(1)
  })

  it('keeps one store on the page for every bundle', () => {
    expect(ResourceStoreModel.page()).toBe(ResourceStoreModel.page())
  })
})
