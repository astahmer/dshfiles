import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Skill from '@deepseek-ai/dsh-skill'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { expect, it } from 'vitest'
import plugin from './host.js'
import { compatSettings } from './settings.js'

it('maps skills, context hooks and durable plugin storage', async () => {
  using recorder = recordSpans()
  const root = await mkdtemp(join(tmpdir(), 'opencode-compat-'))
  const host = await createTestHost()
  const fixture = await import('../tests/fixtures/skills-context-storage.mjs')
  const document = {
    ns: compatSettings.namespace,
    value: {
      plugins: [{ specifier: fileURLToPath(new URL('../tests/fixtures/skills-context-storage.mjs', import.meta.url)), options: '{}', enabled: true }],
      onUnsupported: 'report',
    },
    revision: 1,
  }
  host.ctx.provide('settings', { configure: () => () => undefined, describe: () => [document], update: async () => undefined, replace: async () => undefined })
  try {
    await host.ctx.plugin(Skill)
    await host.ctx.plugin(Storage)
    await host.ctx.plugin(StorageJson, { root })
    await host.ctx.plugin(StorageDomain, { backend: 'json' })
    const removeSection = host.ctx.systemPrompt.section({ name: 'fixture', order: 1, text: 'original' })
    const removeDropSection = host.ctx.systemPrompt.section({ name: 'fixture-drop', order: 2, text: 'drop me' })
    const removeTool = host.ctx.systemPrompt.tools(() => ({
      schemas: [
        { name: 'remove_me', description: 'Remove', parameters: {} },
        { name: 'keep_me', description: 'Keep', parameters: {} },
      ],
    }))
    let mounted = await host.mount(plugin, { packageId: '@dshfiles/opencode-compat' })
    const status = await host.tools.execute({
      callId: ToolCallId('status'),
      name: 'opencode_plugins_status',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(JSON.stringify(status.content)).toContain('loaded')
    const skill = await host.ctx.skills.get('compat-skill')
    expect(skill?.content).toBe('Hello')
    expect(skill?.invocation.modelInvocable).toBe(false)
    const assembly = await host.ctx.systemPrompt.assemble()
    expect(assembly.sections.some(section => section.text === 'opencode-compat: hello')).toBe(true)
    expect(assembly.sections.find(section => section.name === 'fixture')?.text).toBe('original edited')
    expect(assembly.sections.some(section => section.text === 'drop me')).toBe(false)
    expect(assembly.tools.find(tool => tool.name === 'keep_me')?.description).toBe('changed description')
    expect(assembly.tools.map(tool => tool.name)).toContain('keep_me')
    expect(assembly.tools.map(tool => tool.name)).not.toContain('remove_me')
    const afterAssembly = await host.tools.execute({
      callId: ToolCallId('status-after'),
      name: 'opencode_plugins_status',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(JSON.stringify(afterAssembly.content)).toContain('ctx.session.hook(context).messages')
    expect(JSON.stringify(afterAssembly.content)).not.toContain('ctx.session.hook(context).system.edit')
    expect(fixture.state.value).toEqual({ value: 1 })
    const storage = fixture.state.storage
    await expect(storage.set('invalid', undefined)).rejects.toThrow()
    await storage.set('prefix/b', 2)
    await storage.set('prefix/c', 3)
    expect(await storage.scan({ prefix: 'prefix/', after: 'prefix/a', limit: 1 })).toEqual({ entries: [{ key: 'prefix/b', value: 2 }], next: 'prefix/b' })
    await storage.remove('prefix/b')
    expect(await storage.get('prefix/b')).toBeUndefined()
    expect(recorder.span('opencode-storage set')).toBeDefined()
    expect(recorder.span('opencode-storage get')).toBeDefined()
    expect(recorder.span('opencode-storage scan')).toBeDefined()
    expect(recorder.span('opencode-storage remove')).toBeDefined()
    await mounted.dispose()
    expect(await host.ctx.skills.get('compat-skill')).toBeUndefined()
    const disposedAssembly = await host.ctx.systemPrompt.assemble()
    expect(disposedAssembly.tools.map(tool => tool.name)).toContain('remove_me')
    expect(disposedAssembly.sections.some(section => section.text === 'opencode-compat: hello')).toBe(false)
    expect(disposedAssembly.sections.find(section => section.name === 'fixture')?.text).toBe('original')
    expect(disposedAssembly.sections.some(section => section.text === 'drop me')).toBe(true)
    mounted = await host.mount(plugin, { packageId: '@dshfiles/opencode-compat' })
    expect(await fixture.state.storage.get('prefix/c')).toBe(3)
    await mounted.dispose()
    removeTool()
    removeDropSection()
    removeSection()
  } finally {
    await host.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
