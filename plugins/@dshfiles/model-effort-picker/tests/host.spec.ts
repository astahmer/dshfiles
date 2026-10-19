import { describe, expect, it } from 'vitest'
import { createTestHost } from '@dshfiles/dshx/testing'
import plugin from '../src/host.js'

describe('model-effort-picker host entry', () => {
  it('mounts beside the Settings service without registering unrelated Host behavior', async () => {
    const host = await createTestHost()
    host.ctx.provide('settings', {
      configure: () => () => undefined,
      describe: () => [],
      update: async () => undefined,
      replace: async () => undefined,
    })
    try {
      const mounted = await host.mount(plugin)
      expect(host.commands.get('model-effort-picker')).toBeUndefined()
      await mounted.dispose()
    } finally {
      await host.dispose()
    }
  })
})
