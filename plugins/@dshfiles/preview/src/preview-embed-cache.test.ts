import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EmbedCheck } from './embed-policy.js'
import { EMBED_CACHE_LIMIT, PreviewEmbedCache } from './preview-embed-cache.js'

const check = (input: Partial<EmbedCheck> = {}): EmbedCheck => ({
  url: 'http://localhost:5173/',
  reachable: true,
  status: 200,
  framing: 'allowed',
  detail: null,
  ...input,
})

const deferred = () => {
  let resolve: (value: EmbedCheck | undefined) => void = () => undefined
  const promise = new Promise<EmbedCheck | undefined>(next => {
    resolve = next
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('PreviewEmbedCache', () => {
  it('answers unknown until a check lands, then reads it synchronously', async () => {
    const cache = new PreviewEmbedCache()
    expect(cache.verdict('http://localhost:5173/')).toBe('unknown')
    await cache.ask({ url: 'http://localhost:5173/', probe: async () => check() })
    expect(cache.verdict('http://localhost:5173/')).toBe('open')
  })

  it('shares one Host request between callers and reports the answer once', async () => {
    const cache = new PreviewEmbedCache()
    const gate = deferred()
    const probe = vi.fn(() => gate.promise)
    const settled = vi.fn()
    const first = cache.ask({ url: 'http://localhost:5173/', probe, onSettled: settled })
    const second = cache.ask({ url: 'http://localhost:5173/', probe, onSettled: settled })
    expect(second).toBe(first)
    await Promise.resolve()
    expect(probe).toHaveBeenCalledTimes(1)
    gate.resolve(check({ framing: 'denied', detail: 'X-Frame-Options: deny' }))
    await first
    expect(settled).toHaveBeenCalledTimes(1)
    expect(cache.verdict('http://localhost:5173/')).toBe('refused')
  })

  it('keeps a work-free verdict for an unreachable address, and forgets it after the TTL', async () => {
    vi.useFakeTimers()
    const cache = new PreviewEmbedCache()
    await cache.ask({ url: 'http://localhost:5173/', probe: async () => check({ reachable: false, status: null }) })
    expect(cache.verdict('http://localhost:5173/')).toBe('unreachable')
    await vi.advanceTimersByTimeAsync(61_000)
    expect(cache.verdict('http://localhost:5173/')).toBe('unknown')
  })

  it('never grows past its limit and forgets the oldest answer first', async () => {
    const cache = new PreviewEmbedCache()
    for (let index = 0; index <= EMBED_CACHE_LIMIT; index += 1) {
      await cache.ask({ url: `http://localhost:${String(5000 + index)}/`, probe: async () => check() })
    }
    expect(cache.verdict('http://localhost:5000/')).toBe('unknown')
    expect(cache.verdict(`http://localhost:${String(5000 + EMBED_CACHE_LIMIT)}/`)).toBe('open')
  })
})
