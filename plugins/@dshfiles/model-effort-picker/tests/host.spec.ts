import { describe, expect, it } from 'vitest'
import { createTestHost } from '@dshfiles/dshx/testing'
import plugin from '../src/host.js'

describe('model-effort-picker host entry', () => {
  it('mounts and unloads without registering unrelated Host behavior', async () => {
    const host = await createTestHost()
    try {
      const mounted = await host.mount(plugin)
      expect(host.commands.get('model-effort-picker')).toBeUndefined()
      await mounted.dispose()
    } finally {
      await host.dispose()
    }
  })
})
