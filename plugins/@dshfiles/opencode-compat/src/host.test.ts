import { fileURLToPath } from 'node:url'
import { createTestHost } from '@dshfiles/dshx/testing'
import { expect, it, vi } from 'vitest'
import plugin from './host.js'
import { compatSettings } from './settings.js'

it('reloads plugins when settings change and disposes them when unmounted', async () => {
  const fixture = await import('../tests/fixtures/basic.mjs')
  fixture.events.length = 0
  const host = await createTestHost()
  const namespace = compatSettings.namespace
  let document = {
    ns: namespace,
    value: {
      plugins: [{ specifier: fileURLToPath(new URL('../tests/fixtures/basic.mjs', import.meta.url)), options: '{"revision":1}', enabled: true }],
      onUnsupported: 'report',
    },
    revision: 1,
  }
  host.ctx.provide('settings', {
    configure: () => () => undefined,
    describe: () => [document],
    update: async () => undefined,
    replace: async () => undefined,
  })
  try {
    const mounted = await host.mount(plugin, { packageId: '@dshfiles/opencode-compat' })
    expect(fixture.events).toHaveLength(1)
    const result = await host.runTool({ name: 'opencode_plugins_status', arguments: {} })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.content)).toContain('basic')
    expect(JSON.stringify(result.content)).toContain('loaded')
    document = { ...document, value: { ...document.value, plugins: [{ ...document.value.plugins[0]!, options: '{"revision":2}' }] }, revision: 2 }
    host.ctx.emit('settings/document-updated', namespace, 2)
    await vi.waitFor(() => expect(fixture.events).toHaveLength(3))
    expect(fixture.events[1]).toBe('cleanup')
    expect(fixture.events[2]).toMatchObject({ options: { revision: 2 } })
    await mounted.dispose()
    expect(fixture.events[3]).toBe('cleanup')
  } finally {
    await host.dispose()
  }
})
