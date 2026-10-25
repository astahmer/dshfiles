import { recordSpans } from '@dshfiles/dshx/tracing'
import { expect, it } from 'vitest'
import { createRuntimeStatusCache } from './runtime-status-snapshot-cache.js'

type Status = { readonly ok: boolean; readonly value: string }

const deferred = <Value>() => {
  let finish: (value: Value) => void = () => undefined
  const promise = new Promise<Value>(resolve => {
    finish = resolve
  })
  return { promise, finish }
}

it('coalesces refreshes, caches results, and traces the remote work unit', async () => {
  let now = 1_000
  let loads = 0
  const response = deferred<Status>()
  const cache = createRuntimeStatusCache<Status>({ now: () => now, successTtlMs: 100, failureTtlMs: 500 })
  using recorder = recordSpans()

  const first = cache.refresh('runtime-a', () => {
    loads += 1
    return response.promise
  })
  const second = cache.refresh('runtime-a', async () => {
    loads += 1
    return { ok: true, value: 'duplicate' }
  })

  expect(loads).toBe(1)
  expect(cache.read('runtime-a')).toEqual({ status: undefined, stale: true, refreshing: true })
  response.finish({ ok: true, value: 'ready' })
  await Promise.all([first, second])
  expect(cache.read('runtime-a')).toEqual({ status: { ok: true, value: 'ready' }, stale: false, refreshing: false })
  expect(recorder.span('multi-host runtime status refresh').attributes).toMatchObject({ 'dshx.multi-host.runtime_id': 'runtime-a' })

  now += 100
  expect(cache.read('runtime-a')).toMatchObject({ status: { ok: true, value: 'ready' }, stale: true, refreshing: false })
  cache.invalidate('runtime-a')
  expect(cache.read('runtime-a')).toEqual({ status: undefined, stale: true, refreshing: false })
})

it('keeps failures cached for the longer retry window', async () => {
  let now = 5_000
  const cache = createRuntimeStatusCache<Status>({ now: () => now, successTtlMs: 100, failureTtlMs: 500 })
  await cache.refresh('runtime-a', async () => ({ ok: false, value: 'offline' }))

  now += 499
  expect(cache.read('runtime-a')).toMatchObject({ status: { ok: false, value: 'offline' }, stale: false, refreshing: false })
  now += 1
  expect(cache.read('runtime-a')).toMatchObject({ status: { ok: false, value: 'offline' }, stale: true, refreshing: false })
})

it('discards an in-flight result after explicit invalidation', async () => {
  const response = deferred<Status>()
  const cache = createRuntimeStatusCache<Status>({ now: () => 1_000, successTtlMs: 100, failureTtlMs: 500 })
  const refresh = cache.refresh('runtime-a', () => response.promise)
  cache.invalidate('runtime-a')
  response.finish({ ok: true, value: 'obsolete' })
  await refresh
  expect(cache.read('runtime-a')).toEqual({ status: undefined, stale: true, refreshing: false })
})
