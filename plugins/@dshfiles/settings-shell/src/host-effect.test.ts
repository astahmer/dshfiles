import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from 'vitest'
import plugin from './host.js'

describe('settings-shell Effect Host bridge', () => {
  it('serves the existing settings API through the plugin runtime', async () => {
    const host = await createTestHost()
    host.ctx.provide('settings', {
      configure: () => () => undefined,
      writable: true,
      describe: () => [{ ns: 'ui-theme', revision: 3, autoGenerate: true, value: { mode: 'dark' } }],
      update: async () => undefined,
      mutate: async () => undefined,
    })

    try {
      await host.mount(plugin, { packageId: '@dshfiles/settings-shell' })
      const response = await host.connection.requestApi({
        packageId: '@dshfiles/settings-shell',
        apiId: 'settings-shell',
        method: 'list',
        version: 1,
        input: {},
      })
      expect(await response.json()).toMatchObject({
        result: {
          ok: true,
          value: {
            output: {
              writable: true,
              namespaces: [{ namespace: 'ui-theme', revision: 3, autoGenerate: true, secretFields: 0 }],
            },
            version: 1,
          },
        },
      })
    } finally {
      await host.dispose()
    }
  })
})
