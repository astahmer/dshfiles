import { Context } from '@deepseek-ai/cordis'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelCatalogDirectory } from '../src/native/catalog.ts'

const catalogValue: ModelCatalog = {
  default: { provider: 'provider', model: 'first' },
  routableProviders: ['provider'],
  groups: [{ id: 'provider', name: 'Provider', models: [{ id: 'first', name: 'First' }] }],
  failures: [],
}

const fixture = () => {
  const ctx = new Context()
  const modelCatalog = vi.fn(async () => ({ ok: true as const, value: catalogValue }))
  ctx.provide('remote', { session: { modelCatalog } })
  return { catalog: new ModelCatalogDirectory(ctx), modelCatalog }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('ModelCatalogDirectory.scheduleRefresh', () => {
  it('reads the catalog once for a burst of change events', async () => {
    const { catalog, modelCatalog } = fixture()
    await catalog.load()
    expect(modelCatalog).toHaveBeenCalledTimes(1)

    for (let event = 0; event < 4; event += 1) catalog.scheduleRefresh()
    expect(modelCatalog).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(50)
    expect(modelCatalog).toHaveBeenCalledTimes(2)
    expect(catalog.store.getSnapshot().status).toBe('ready')
  })

  it('refreshes again for a later burst', async () => {
    const { catalog, modelCatalog } = fixture()
    await catalog.load()
    catalog.scheduleRefresh()
    await vi.advanceTimersByTimeAsync(50)
    catalog.scheduleRefresh()
    await vi.advanceTimersByTimeAsync(50)
    expect(modelCatalog).toHaveBeenCalledTimes(3)
  })

  it('shares one catalog read with another owner refreshing for the same burst', async () => {
    const ctx = new Context()
    // A Host answer takes a network round trip, so both owners' refresh timers fire while the first read is open.
    const modelCatalog = vi.fn(() => new Promise<{ ok: true; value: ModelCatalog }>(resolve => setTimeout(() => resolve({ ok: true, value: catalogValue }), 5)))
    ctx.provide('remote', { session: { modelCatalog } })
    const selector = new ModelCatalogDirectory(ctx)
    const otherOwner = new ModelCatalogDirectory(ctx)
    const loads = Promise.all([selector.load(), otherOwner.load()])
    await vi.advanceTimersByTimeAsync(5)
    await loads
    expect(modelCatalog).toHaveBeenCalledTimes(1)

    selector.scheduleRefresh()
    otherOwner.scheduleRefresh()
    await vi.advanceTimersByTimeAsync(55)
    expect(modelCatalog).toHaveBeenCalledTimes(2)
    expect(otherOwner.store.getSnapshot().status).toBe('ready')
  })

  it('does not join a read that started before the change it refreshes for', async () => {
    const ctx = new Context()
    const answers: ((value: { ok: true; value: ModelCatalog }) => void)[] = []
    const modelCatalog = vi.fn(
      () =>
        new Promise<{ ok: true; value: ModelCatalog }>(resolve => {
          answers.push(resolve)
        }),
    )
    ctx.provide('remote', { session: { modelCatalog } })
    const otherOwner = new ModelCatalogDirectory(ctx)
    const selector = new ModelCatalogDirectory(ctx)
    void otherOwner.load()
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 10)
    selector.scheduleRefresh()
    await vi.advanceTimersByTimeAsync(50)
    expect(modelCatalog).toHaveBeenCalledTimes(2)
    for (const answer of answers) answer({ ok: true, value: catalogValue })
    vi.restoreAllMocks()
  })

  it('drops a pending refresh when the Host generation resets', async () => {
    const { catalog, modelCatalog } = fixture()
    await catalog.load()
    catalog.scheduleRefresh()
    catalog.resetGeneration()
    await vi.advanceTimersByTimeAsync(50)
    expect(modelCatalog).toHaveBeenCalledTimes(2)
  })
})
