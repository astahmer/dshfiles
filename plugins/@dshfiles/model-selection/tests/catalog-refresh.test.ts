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

  it('drops a pending refresh when the Host generation resets', async () => {
    const { catalog, modelCatalog } = fixture()
    await catalog.load()
    catalog.scheduleRefresh()
    catalog.resetGeneration()
    await vi.advanceTimersByTimeAsync(50)
    expect(modelCatalog).toHaveBeenCalledTimes(2)
  })
})
