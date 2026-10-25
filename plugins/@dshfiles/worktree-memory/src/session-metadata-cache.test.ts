import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from 'vitest'
import { createSessionMetadataCache } from './session-metadata-cache.js'
import type { KnownSession } from './process-table.js'

const session: KnownSession = {
  sessionId: 'session-1',
  cwd: '/repo',
  running: false,
  updatedAt: 100,
  title: 'Cached thread',
}

const deferred = <Value>() => {
  let resolvePromise: (value: Value) => void = () => undefined
  const promise = new Promise<Value>(resolve => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

describe('session metadata cache', () => {
  it('returns the current value without waiting and coalesces a refresh', async () => {
    using recorder = recordSpans()
    const cache = createSessionMetadataCache(() => 1)
    const pending = deferred<readonly KnownSession[] | undefined>()
    let loads = 0
    const load = (): Promise<readonly KnownSession[] | undefined> => {
      loads += 1
      return pending.promise
    }

    expect(cache.read(load)).toEqual([])
    expect(cache.read(load)).toEqual([])
    expect(loads).toBe(0)

    pending.resolve([session])
    await cache.refresh(load)

    expect(cache.read(load)).toEqual([session])
    expect(loads).toBe(1)
    expect(recorder.span('worktree-memory list sessions')).toBeDefined()
  })

  it('keeps the last good value and backs off a failed refresh', async () => {
    let now = 1
    const cache = createSessionMetadataCache(() => now)
    let loads = 0
    const load = async (): Promise<readonly KnownSession[] | undefined> => {
      loads += 1
      return [session]
    }

    expect(cache.read(load)).toEqual([])
    await cache.refresh(load)
    expect(cache.read(load)).toEqual([session])
    expect(loads).toBe(1)

    now += 30_000
    const failedLoad = async (): Promise<readonly KnownSession[] | undefined> => {
      loads += 1
      return undefined
    }
    expect(cache.read(failedLoad)).toEqual([session])
    await cache.refresh(failedLoad)

    now += 44_999
    expect(cache.read(load)).toEqual([session])
    expect(loads).toBe(2)
    now += 1
    expect(cache.read(load)).toEqual([session])
    await cache.refresh(load)
    expect(loads).toBe(3)
  })
})
