import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, type StreamChunk } from '@deepseek-ai/dsh-llm'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, it, vi } from 'vitest'
import { ModelCatalogBuild } from '../../src/model-catalog-build.ts'
import { buildModelCatalog } from '../../src/native/catalog.ts'
import type { ModelCatalog } from '../../src/native/types.ts'

const catalog = (model: string): ModelCatalog => ({
  default: { provider: 'x', model },
  routableProviders: [],
  groups: [],
  failures: [],
})

describe('ModelCatalogBuild coordination', () => {
  it('shares the exact promise and one build for concurrent callers and the full unexpired cache window', async () => {
    let now = 100
    const pending = Promise.withResolvers<ModelCatalog>()
    const build = vi.fn<() => Promise<ModelCatalog>>().mockReturnValue(pending.promise)
    const cache = new ModelCatalogBuild(
      () => 'default',
      build,
      () => now,
    )
    const first = cache.load()
    expect(cache.load()).toBe(first)
    await Promise.resolve()
    expect(build).toHaveBeenCalledOnce()
    now = 5_099
    expect(cache.load()).toBe(first)
    const value = catalog('first')
    pending.resolve(value)
    await expect(first).resolves.toBe(value)
    expect(cache.load()).toBe(first)
    expect(build).toHaveBeenCalledOnce()
  })

  it('expires at exactly five seconds using the injected clock, without timers', async () => {
    let now = 10
    const firstValue = catalog('first')
    const secondValue = catalog('second')
    const build = vi.fn<() => Promise<ModelCatalog>>().mockResolvedValueOnce(firstValue).mockResolvedValueOnce(secondValue)
    const cache = new ModelCatalogBuild(
      () => 'default',
      build,
      () => now,
    )
    const first = cache.load()
    await expect(first).resolves.toBe(firstValue)
    now = 5_009
    expect(cache.load()).toBe(first)
    now = 5_010
    const second = cache.load()
    expect(second).not.toBe(first)
    await expect(second).resolves.toBe(secondValue)
    expect(build).toHaveBeenCalledTimes(2)
    expect(cache.load()).toBe(second)
  })

  it('rebuilds immediately when the default key changes inside the TTL', async () => {
    let key = 'default-a'
    const firstValue = catalog('first')
    const secondValue = catalog('second')
    const build = vi.fn<() => Promise<ModelCatalog>>().mockResolvedValueOnce(firstValue).mockResolvedValueOnce(secondValue)
    const cache = new ModelCatalogBuild(
      () => key,
      build,
      () => 100,
    )
    const first = cache.load()
    await first
    key = 'default-b'
    const second = cache.load()
    expect(second).not.toBe(first)
    await expect(second).resolves.toBe(secondValue)
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('invalidates immediately even when the default key and provider are unchanged', async () => {
    const firstValue = catalog('same-model')
    const updated: ModelCatalog = { ...firstValue, routableProviders: ['new-account'] }
    const build = vi.fn<() => Promise<ModelCatalog>>().mockResolvedValueOnce(firstValue).mockResolvedValueOnce(updated)
    const cache = new ModelCatalogBuild(
      () => 'unchanged-default',
      build,
      () => 100,
    )
    const first = cache.load()
    await first
    cache.invalidate()
    const second = cache.load()
    expect(second).not.toBe(first)
    await expect(second).resolves.toBe(updated)
    expect(build).toHaveBeenCalledTimes(2)
  })

  it.each(['resolve', 'reject'] as const)(
    'forwards an obsolete in-flight %s to the new generation without replacing or evicting its cache',
    async settlement => {
      const old = Promise.withResolvers<ModelCatalog>()
      const fresh = catalog('fresh')
      const build = vi.fn<() => Promise<ModelCatalog>>().mockReturnValueOnce(old.promise).mockResolvedValueOnce(fresh)
      const cache = new ModelCatalogBuild(
        () => 'unchanged-default',
        build,
        () => 100,
      )
      const first = cache.load()
      await Promise.resolve()
      cache.invalidate()
      const second = cache.load()
      await expect(second).resolves.toBe(fresh)
      if (settlement === 'resolve') old.resolve(catalog('obsolete'))
      else old.reject(new Error('Obsolete provider lookup failed'))
      await expect(first).resolves.toBe(fresh)
      expect(cache.load()).toBe(second)
      expect(build).toHaveBeenCalledTimes(2)
    },
  )

  it.each(['resolve', 'reject'] as const)('shares one slow pending build across multiple TTL intervals until it can %s', async settlement => {
    let now = 100
    const pending = Promise.withResolvers<ModelCatalog>()
    const fresh = catalog('fresh-after-settlement')
    const build = vi.fn<() => Promise<ModelCatalog>>().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(fresh)
    const cache = new ModelCatalogBuild(
      () => 'unchanged-default',
      build,
      () => now,
    )
    const first = cache.load()
    await Promise.resolve()
    const readers = [first]
    for (const readAt of [5_100, 10_100, 25_100, 100_100]) {
      now = readAt
      const reader = cache.load()
      expect(reader).toBe(first)
      readers.push(reader)
    }
    expect(build).toHaveBeenCalledOnce()
    const completed = Promise.all(readers)
    if (settlement === 'resolve') {
      const value = catalog('slow-success')
      pending.resolve(value)
      const results = await completed
      for (const result of results) expect(result).toBe(value)
      now += 4_999
      expect(cache.load()).toBe(first)
      expect(build).toHaveBeenCalledOnce()
      now += 1
    } else {
      const failure = new Error('Slow current lookup failed')
      const rejected = expect(completed).rejects.toBe(failure)
      pending.reject(failure)
      await rejected
    }
    const next = cache.load()
    expect(next).not.toBe(first)
    await expect(next).resolves.toBe(fresh)
    expect(cache.load()).toBe(next)
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('clears only the current rejected build so the next caller can retry', async () => {
    const failed = Promise.withResolvers<ModelCatalog>()
    const fresh = catalog('retry')
    const build = vi.fn<() => Promise<ModelCatalog>>().mockReturnValueOnce(failed.promise).mockResolvedValueOnce(fresh)
    const cache = new ModelCatalogBuild(
      () => 'default',
      build,
      () => 100,
    )
    const first = cache.load()
    const rejected = expect(first).rejects.toThrow('Current lookup failed')
    failed.reject(new Error('Current lookup failed'))
    await rejected
    const retry = cache.load()
    expect(retry).not.toBe(first)
    await expect(retry).resolves.toBe(fresh)
    expect(build).toHaveBeenCalledTimes(2)
    expect(cache.load()).toBe(retry)
  })

  it.each(['resolve', 'reject'] as const)('forwards an old default-key build on %s even before another caller requests the new default', async settlement => {
    let key = 'old-default'
    const old = Promise.withResolvers<ModelCatalog>()
    const fresh = catalog('new-default')
    const build = vi.fn<() => Promise<ModelCatalog>>().mockReturnValueOnce(old.promise).mockResolvedValueOnce(fresh)
    const cache = new ModelCatalogBuild(
      () => key,
      build,
      () => 100,
    )
    const first = cache.load()
    await Promise.resolve()
    key = 'new-default'
    if (settlement === 'resolve') old.resolve(catalog('obsolete'))
    else old.reject(new Error('Old default lookup failed'))
    await expect(first).resolves.toBe(fresh)
    await expect(cache.load()).resolves.toBe(fresh)
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('does not reuse an old promise when the default key changes away and back while a build is pending', async () => {
    let key = 'default-a'
    const old = Promise.withResolvers<ModelCatalog>()
    const middle = catalog('default-b')
    const fresh = catalog('default-a-refreshed')
    const build = vi.fn<() => Promise<ModelCatalog>>().mockReturnValueOnce(old.promise).mockResolvedValueOnce(middle).mockResolvedValueOnce(fresh)
    const cache = new ModelCatalogBuild(
      () => key,
      build,
      () => 100,
    )
    const first = cache.load()
    await Promise.resolve()
    key = 'default-b'
    await expect(cache.load()).resolves.toBe(middle)
    key = 'default-a'
    const current = cache.load()
    await expect(current).resolves.toBe(fresh)
    old.resolve(catalog('obsolete-default-a'))
    await expect(first).resolves.toBe(fresh)
    expect(cache.load()).toBe(current)
    expect(build).toHaveBeenCalledTimes(3)
  })
})

/** Metadata-only provider seam; catalog tests must never issue a model request. */
class CatalogAdapter extends LlmAdapter {
  model = 'model-one'
  override async listModels(provider: string) {
    return [{ provider, id: this.model, name: this.model }]
  }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model }
  }
  override stream(): AsyncIterable<StreamChunk> {
    throw new Error('Catalog construction must not issue model requests')
  }
}

it('public LlmRuntime registration, same-route replacement, disposal and directory updates invalidate the bound catalog synchronously', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(LlmRuntime)
    const defaultSelection = { provider: 'codex', model: 'model-one' }
    ctx.llm.registerAdapter(['codex'], new CatalogAdapter())
    const build = vi.fn(() => buildModelCatalog(ctx, defaultSelection))
    const cache = new ModelCatalogBuild(
      () => JSON.stringify(defaultSelection),
      build,
      () => 100,
    )
    const invalidated = vi.fn(() => cache.invalidate())
    ctx.on('llm/adapters-updated', invalidated)
    let current = cache.load()
    expect((await current).routableProviders).toEqual(['codex'])

    const commandCode = new CatalogAdapter()
    const registration = ctx.llm.registerAdapter(['commandcode'], commandCode)
    expect(invalidated).toHaveBeenCalledTimes(1)
    let next = cache.load()
    expect(next).not.toBe(current)
    expect((await next).routableProviders).toEqual(['codex', 'commandcode'])
    current = next

    commandCode.model = 'newly-available-model'
    registration.replace(['commandcode'])
    expect(invalidated).toHaveBeenCalledTimes(2)
    next = cache.load()
    expect(next).not.toBe(current)
    expect((await next).groups.find(group => group.id === 'commandcode')?.models.map(model => model.id)).toEqual(['newly-available-model'])
    current = next

    registration()
    expect(invalidated).toHaveBeenCalledTimes(3)
    next = cache.load()
    expect(next).not.toBe(current)
    expect((await next).routableProviders).toEqual(['codex'])
    current = next

    const directory = ctx.llm.registerConfigurableProviders([{ provider: 'dormant', displayName: 'Dormant', settingsNs: 'catalog-test', settingsPath: [] }])
    expect(invalidated).toHaveBeenCalledTimes(4)
    next = cache.load()
    expect(next).not.toBe(current)
    await next
    current = next
    directory.replace([{ provider: 'dormant', displayName: 'Changed', settingsNs: 'catalog-test', settingsPath: [] }])
    expect(invalidated).toHaveBeenCalledTimes(5)
    next = cache.load()
    expect(next).not.toBe(current)
    await next
    current = next
    directory()
    expect(invalidated).toHaveBeenCalledTimes(6)
    next = cache.load()
    expect(next).not.toBe(current)
    expect((await next).routableProviders).toEqual(['codex'])
    expect(build).toHaveBeenCalledTimes(7)
  } finally {
    await ctx.fiber.dispose()
  }
})
