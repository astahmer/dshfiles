import { fileURLToPath } from 'node:url'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createTestHost } from '@dshfiles/dshx/testing'
import { expect, it } from 'vitest'
import { start } from '../runtime.js'
import { createToolDomain } from './tool.js'

it('runs and reloads compat tools and hooks in the real tool runtime', async () => {
  const host = await createTestHost()
  const fixture = await import('../../tests/fixtures/tools.mjs')
  const manager = await start({
    entries: [{ specifier: fileURLToPath(new URL('../../tests/fixtures/tools.mjs', import.meta.url)), options: '{}', enabled: true }],
    onUnsupported: 'report',
    domains: { tool: createToolDomain({ ctx: host.ctx }) },
  })
  const call = (name: string, args: { text: string | number }) =>
    host.tools.execute({ callId: ToolCallId('call'), name, arguments: args, signal: new AbortController().signal })
  try {
    expect(manager.status()[0]?.error).toBeNull()
    expect(host.tools.get('oc_echo')).toBeDefined()
    const result = await call('oc_echo', { text: 'hello' })
    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{ type: 'text', text: 'hello [after]' }])
    expect(result.value).toBe('hello')
    expect((await call('oc_echo', { text: 123 })).isError).toBe(true)
    const denied = await call('oc_echo', { text: 'deny-me' })
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied.content)).toContain('Denied by OpenCode plugin')
    const offProbe = host.ctx.tools.register({
      name: 'native_probe',
      description: 'Native tool the plugin did not register.',
      parameters: { type: 'object', properties: { text: { type: 'string' } } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
      execute: async () => 'ran',
    })
    const rewritten = await call('native_probe', { text: 'original' })
    offProbe()
    expect(rewritten.isError).toBe(true)
    expect(JSON.stringify(rewritten.content)).toContain('Host gap 112')
    await fixture.toolDomain.reload()
    expect((await call('oc_echo', { text: 'reload' })).content).toEqual([{ type: 'text', text: 'reload [after]' }])
    await manager.dispose()
    expect(host.tools.get('oc_echo')).toBeUndefined()
  } finally {
    await manager.dispose()
    await host.dispose()
  }
})
