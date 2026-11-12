import { resourceStore, type ResourceInvalidationSource } from '@dshfiles/dshx/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ATTENTION_READ, attentionApi } from './attention-api.js'

const tags: readonly string[] = attentionApi.methods.list.tags ?? []
const events = Object.values(attentionApi.events ?? {}).filter(definition => definition.invalidates?.some(tag => tags.includes(tag)) === true)

describe('attention list resource', () => {
  afterEach(() => {
    resourceStore().clear()
    vi.useRealTimers()
  })

  it('shares one read and invalidation and polls only while disconnected', async () => {
    vi.useFakeTimers()
    const store = resourceStore()
    const fetch = vi.fn(async () => ({}))
    let push = (): void => undefined
    let setLive = (_live: boolean): void => undefined
    let subscriptions = 0
    const invalidatedBy: ResourceInvalidationSource[] = events.map((definition, index) => ({
      id: `attention-event-${String(index)}`,
      tags: definition.invalidates ?? [],
      subscribe: handlers => {
        subscriptions += 1
        push = handlers.onInvalidate
        setLive = handlers.onLive
        setLive(true)
        return () => undefined
      },
    }))
    const key = store.register({ key: 'attention-needs-you', fetch, tags, invalidatedBy, ...ATTENTION_READ })
    const otherFetch = vi.fn(async () => ({}))
    const otherKey = store.register({ key: 'attention-other', fetch: otherFetch, tags, invalidatedBy, ...ATTENTION_READ })
    const first = store.subscribe(key, () => undefined)
    const second = store.subscribe(key, () => undefined)
    const third = store.subscribe(otherKey, () => undefined)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(events).toHaveLength(1)
    expect(subscriptions).toBe(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(otherFetch).toHaveBeenCalledTimes(1)
    push()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(otherFetch).toHaveBeenCalledTimes(2)
    setLive(false)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetch).toHaveBeenCalledTimes(3)
    first()
    second()
    third()
  })
})
