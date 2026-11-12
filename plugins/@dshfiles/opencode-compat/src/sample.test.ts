import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Skill from '@deepseek-ai/dsh-skill'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { createTestHost } from '@dshfiles/dshx/testing'
import { expect, it, vi } from 'vitest'
import plugin from './host.js'
import { compatSettings } from './settings.js'

it('runs a representative plugin and disposes its contributions on disable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencode-sample-'))
  const host = await createTestHost()
  const fixture = await import('../tests/fixtures/opencode-sample/index.mjs')
  fixture.state.cleaned = false
  let document = {
    ns: compatSettings.namespace,
    value: {
      plugins: [{ specifier: fileURLToPath(new URL('../tests/fixtures/opencode-sample/index.mjs', import.meta.url)), options: '{}', enabled: true }],
      onUnsupported: 'report',
    },
    revision: 1,
  }
  host.ctx.provide('settings', { configure: () => () => undefined, describe: () => [document], update: async () => undefined, replace: async () => undefined })
  const call = (name: string, args: { text?: string }) => host.runTool({ name, arguments: args })
  try {
    await host.ctx.plugin(Skill)
    await host.ctx.plugin(Storage)
    await host.ctx.plugin(StorageJson, { root })
    await host.ctx.plugin(StorageDomain, { backend: 'json' })
    const mounted = await host.mount(plugin, { packageId: '@dshfiles/opencode-compat' })
    expect(JSON.stringify((await call('opencode_plugins_status', {})).content)).toContain('loaded')
    expect((await call('sample_echo', { text: 'hello' })).content).toEqual([{ type: 'text', text: 'hello (via opencode-sample)' }])
    expect(fixture.state.calls).toBe(1)
    const denied = await call('sample_echo', { text: 'blocked' })
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied.content)).toContain('Denied by opencode-sample')
    expect(await host.ctx.skills.get('sample-skill')).toBeDefined()
    expect((await host.ctx.systemPrompt.assemble()).sections.some(section => section.text === 'opencode-sample: system line')).toBe(true)
    const status = JSON.stringify((await call('opencode_plugins_status', {})).content)
    expect(status).toContain('ctx.mcp.transform')
    expect(status).toContain('sample_echo')
    expect(status).toContain('sample-skill')
    expect(status).toContain('tool.execute.before')
    expect(status).toContain('tool.execute.after')
    expect(status).toContain('session.context')
    document = { ...document, value: { ...document.value, plugins: [{ ...document.value.plugins[0]!, enabled: false }] }, revision: 2 }
    host.ctx.emit('settings/document-updated', compatSettings.namespace, 2)
    await vi.waitFor(() => expect(fixture.state.cleaned).toBe(true))
    expect(host.tools.get('sample_echo')).toBeUndefined()
    expect(await host.ctx.skills.get('sample-skill')).toBeUndefined()
    expect((await host.ctx.systemPrompt.assemble()).sections.some(section => section.text === 'opencode-sample: system line')).toBe(false)
    await mounted.dispose()
  } finally {
    await host.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
