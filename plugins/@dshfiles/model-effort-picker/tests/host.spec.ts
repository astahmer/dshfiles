import type {} from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { createTestHost } from '@dshfiles/dshx/testing'
import plugin from '../src/host.js'

describe('model-effort-picker host entry', () => {
  it('returns known and unknown context capacity and rejects invalid route input', async () => {
    const host = await createTestHost()
    host.ctx.provide('settings', {
      configure: () => () => undefined,
      describe: () => [],
      update: async () => undefined,
      replace: async () => undefined,
    })
    let routeContextWindow: number | null = 10_000
    const routes: string[] = []
    host.ctx.provide('llm', {
      resolveModelInfo: async (provider: string, model: string) => {
        routes.push(`${provider}/${model}`)
        return { context: routeContextWindow === null ? undefined : { contextWindow: routeContextWindow } }
      },
    })
    try {
      const mounted = await host.mount(plugin, { packageId: '@dshfiles/model-effort-picker' })
      const request = {
        packageId: '@dshfiles/model-effort-picker',
        apiId: 'model-handoff',
        method: 'contextWindow',
        version: 1,
      }
      const known = await host.connection.requestApi({ ...request, input: { provider: 'provider', model: 'model' } })
      expect(await known.json()).toMatchObject({ result: { ok: true, value: { output: 10_000, version: 1 } } })
      routeContextWindow = null
      const unknown = await host.connection.requestApi({ ...request, input: { provider: 'provider', model: 'unknown-capacity' } })
      expect(await unknown.json()).toMatchObject({ result: { ok: true, value: { output: null, version: 1 } } })
      const invalid = await host.connection.requestApi({ ...request, input: { provider: 'provider', model: '' } })
      expect(await invalid.json()).toMatchObject({ result: { ok: false, error: { code: 'contract' } } })
      expect(routes).toEqual(['provider/model', 'provider/unknown-capacity'])
      await mounted.dispose()
    } finally {
      await host.dispose()
    }
  })
})
