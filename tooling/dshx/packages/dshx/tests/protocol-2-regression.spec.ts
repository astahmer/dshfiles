import Schema from '@deepseek-ai/schemastery'
import { describe, expect, it } from 'vitest'
import { createHostPlugin } from '../src/host/runtime.js'
import { createClientPlugin } from '../src/client/runtime.js'
import { defineSettings } from '../src/settings/index.js'
import { defineApi, method } from '../src/api/index.js'
import { ApiRuntimeModel } from '../src/api/runtime.js'
import { PROTOCOL_2_COMPATIBILITY } from '../src/compat/index.js'

describe('installed protocol-2 contract regressions', () => {
  it('exports editable Config before Loader activation', () => {
    const contract = defineSettings({
      namespace: 'example',
      schema: Schema.object({ enabled: Schema.boolean().default(true) }),
    })
    const plugin = createHostPlugin({ settings: [contract] }, { packageId: '@test/example', compatibility: PROTOCOL_2_COMPATIBILITY })
    expect(plugin.Config).toBeTypeOf('function')
    expect((plugin.Config as typeof contract.schema).meta.volatile).toBe(true)
    expect(contract.schema.meta.volatile).not.toBe(true)
  })

  it('rejects multiple settings owners for one native Loader entry', () => {
    const contract = defineSettings({
      namespace: 'example',
      schema: Schema.object({}),
    })
    expect(() => createHostPlugin({ settings: [contract, contract] }, { packageId: '@test/example' })).toThrow('one Settings contract')
  })

  it('injects the native ConfigForms provider for Settings hooks', () => {
    const plugin = createClientPlugin(
      {},
      {
        packageId: '@test/example',
        settingsCapability: true,
        compatibility: PROTOCOL_2_COMPATIBILITY,
      },
    )
    expect(plugin.inject).toEqual(['configForms'])
  })

  it('does not advertise a removed conversation event registry', () => {
    expect(PROTOCOL_2_COMPATIBILITY.client.conversation?.componentContributions).toBe(false)
    expect(PROTOCOL_2_COMPATIBILITY.client.conversation).not.toHaveProperty('eventService')
  })

  it('rejects unsupported per-handler authority rather than silently ignoring it', () => {
    const api = defineApi({
      id: 'example',
      version: 1,
      methods: { ping: method() },
    })
    expect(() => api.host({ ping: () => null }, { authority: 'loopback' })).toThrow('native Connection')
  })

  it.each([NaN, Infinity, new Date(), new Map(), { nested: undefined }, { nested: () => 1 }])('rejects lossy JSON payload %s before transport', async input => {
    const api = defineApi({
      id: 'example',
      version: 1,
      methods: { ping: method<unknown, null>() },
    })
    const client = ApiRuntimeModel.createClient(
      {
        get: () => ({
          rpc: {
            call: () => {
              throw new Error('transport reached')
            },
          },
        }),
      },
      api,
    )
    await expect(client.ping(input)).rejects.toMatchObject({
      kind: 'contract',
    })
  })
})
