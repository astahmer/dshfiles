import { LlmAdapter, LlmRuntime, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { afterEach, describe, expect, it } from 'vitest'
import { HostDefinitionModel } from '../src/host/define.js'
import { createTestHost, type TestHost } from '../src/testing/index.js'

class EchoAdapter extends LlmAdapter {
  override async listModels(provider: string) {
    return [{ provider, id: 'echo-1', name: 'Echo 1' }]
  }
  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const hosts: TestHost[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.dispose()
})

const host = async () => {
  const created = await createTestHost()
  hosts.push(created)
  await created.ctx.plugin(LlmRuntime)
  await created.ctx.plugin(SkillRegistry)
  return created
}

describe('defineHost registrations', () => {
  it('registers a provider, its settings entry, its model listing and a skill for as long as the plugin lives', async () => {
    const test = await host()
    const plugin = await test.mount(
      HostDefinitionModel.define({
        providers: [
          {
            providers: ['echo'],
            adapter: new EchoAdapter(),
            configurable: [{ provider: 'echo', displayName: 'Echo', settingsNs: 'acme-echo', settingsPath: ['apiKey'] }],
          },
        ],
        models: [{ settingsNs: 'acme-echo', discover: async () => [{ id: 'echo-2', name: 'Echo 2' }] }],
        skills: [{ name: 'acme-release', description: 'How Acme ships a release.', source: 'runtime', content: '1. Tag. 2. Publish.' }],
      }),
      { packageId: '@acme/registrations' },
    )
    const ctx = test.ctx
    expect(ctx.llm.listProviders().map(provider => provider.id)).toContain('echo')
    expect(ctx.llm.listConfigurableProviders().map(provider => provider.provider)).toContain('echo')
    expect((await ctx.llm.discoverModels('acme-echo', { provider: 'echo' })).map(model => model.id)).toEqual(['echo-2'])
    expect((await ctx.skills.get('acme-release'))?.content).toBe('1. Tag. 2. Publish.')

    await plugin.dispose()
    expect(ctx.llm.listProviders().map(provider => provider.id)).not.toContain('echo')
    expect(ctx.llm.listConfigurableProviders().map(provider => provider.provider)).not.toContain('echo')
    expect(await ctx.skills.get('acme-release')).toBeUndefined()
  })

  it('refuses a registration field that is not a list', async () => {
    const test = await host()
    await expect(test.mount({ skills: { name: 'not-a-list' } }, { packageId: '@acme/broken' })).rejects.toThrow('skills must be an array')
  })
})
