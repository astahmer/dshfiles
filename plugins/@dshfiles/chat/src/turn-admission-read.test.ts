import { resourceStore } from '@dshfiles/dshx/client'
import { turnAdmissionApi } from '@dshfiles/session-controller/turn-admission-api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TURN_ADMISSION_READ } from './turn-admission-read.ts'

const methodTags: readonly string[] = turnAdmissionApi.methods.snapshot.tags ?? []
const pushingEvents = Object.values(turnAdmissionApi.events ?? {}).filter(definition => definition.invalidates?.some(tag => methodTags.includes(tag)) === true)

describe('waiting-turn admission read', () => {
  afterEach(() => {
    resourceStore().clear()
    vi.useRealTimers()
  })

  it('reads once and again only on a pushed change while the Host event is live, instead of every 3 s', async () => {
    vi.useFakeTimers()
    const store = resourceStore()
    const fetch = vi.fn(async () => ({ policy: { maxRunningThreads: 1, countSubagents: false }, running: 1, waiting: [] }))
    let push = (): void => undefined
    const key = store.register({
      key: 'turn-admission-snapshot-test',
      fetch,
      tags: methodTags,
      invalidatedBy: pushingEvents.map((definition, index) => ({
        id: `turn-admission-source-${String(index)}`,
        tags: definition.invalidates ?? [],
        subscribe: handlers => {
          push = handlers.onInvalidate
          handlers.onLive(true)
          return () => undefined
        },
      })),
      ...TURN_ADMISSION_READ,
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
