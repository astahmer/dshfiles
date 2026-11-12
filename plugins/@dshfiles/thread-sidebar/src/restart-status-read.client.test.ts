import { resourceStore } from '@dshfiles/dshx/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { threadSidebarRestartApi } from './restart-api.js'
import { AUTO_RESTART_READ } from './restart-status-read.js'

const methodTags: readonly string[] = threadSidebarRestartApi.methods.autoRestartStatus.tags ?? []
const pushingEvents = Object.values(threadSidebarRestartApi.events ?? {}).filter(
  definition => definition.invalidates?.some(tag => methodTags.includes(tag)) === true,
)

describe('automatic restart status read', () => {
  afterEach(() => {
    resourceStore().clear()
    vi.useRealTimers()
  })

  it('reads once and again only on a pushed change while the Host event is live, instead of every 5 s', async () => {
    vi.useFakeTimers()
    const store = resourceStore()
    const fetch = vi.fn(async () => ({ phase: 'none' }))
    let push = (): void => undefined
    const key = store.register({
      key: 'auto-restart-status-test',
      fetch,
      tags: methodTags,
      invalidatedBy: pushingEvents.map((definition, index) => ({
        id: `auto-restart-source-${String(index)}`,
        tags: definition.invalidates ?? [],
        subscribe: handlers => {
          push = handlers.onInvalidate
          handlers.onLive(true)
          return () => undefined
        },
      })),
      ...AUTO_RESTART_READ,
    })
    const unsubscribe = store.subscribe(key, () => undefined)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pushingEvents).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(1)
    push()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetch).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})
