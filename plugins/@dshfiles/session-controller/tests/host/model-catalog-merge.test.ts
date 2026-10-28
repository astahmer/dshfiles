import { Context } from '@deepseek-ai/cordis'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import { brandString } from '@deepseek-ai/dsh-brand'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import { LlmAdapter, LlmRuntime, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { expect, it } from 'vitest'
import { SessionModelCatalog } from '../../src/native/catalog.ts'

const gate = () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  return {
    entered: entered.promise,
    release: () => release.resolve(),
    hold: async () => {
      entered.resolve()
      await release.promise
    },
  }
}

/** The only external seam: deterministic metadata; no model request or account network traffic. */
class CatalogAdapter extends LlmAdapter {
  model = 'before-commit'
  reads = 0
  gate: ReturnType<typeof gate> | undefined

  override async listModels(provider: string) {
    const id = this.model
    this.reads += 1
    await this.gate?.hold()
    return [{ provider, id, name: id }]
  }

  override stream(): AsyncIterable<StreamChunk> {
    throw new Error('Catalog coherence must not issue a model request.')
  }
}

it.each(['settings/document-updated', 'credentials/record-updated', 'credentials/reference-updated'] as const)(
  'keeps %s invalidation lazy and forwards a pre-commit in-flight reader to the single committed generation',
  async event => {
    const ctx = new Context()
    const pending = gate()
    try {
      await ctx.plugin(TypertRegistry)
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(AgentDefaultModel, { provider: 'codex', model: 'before-commit' })
      const adapter = new CatalogAdapter()
      const registration = ctx.llm.registerAdapter(['codex'], adapter)
      const cache = new SessionModelCatalog(ctx)
      const before = cache.read()
      await before
      expect(adapter.reads).toBe(1)

      adapter.gate = pending
      if (event === 'settings/document-updated') ctx.emit(event, brandString<SettingsNamespace>('codex'), 1)
      else if (event === 'credentials/record-updated') ctx.emit(event, credentialKey('ai-accounts', 'codex'))
      else ctx.emit(event, credentialRef('E2E_ACCOUNT_KEY'))
      expect(adapter.reads).toBe(1)
      const intervening = cache.read()
      expect(intervening).not.toBe(before)
      expect(cache.read()).toBe(intervening)
      await pending.entered
      expect(adapter.reads).toBe(2)

      adapter.gate = undefined
      adapter.model = 'after-commit'
      registration.replace(['codex', 'commandcode_work'])
      const committed = cache.read()
      expect(committed).not.toBe(intervening)
      const fresh = await committed
      expect(fresh).toMatchObject({
        default: { provider: 'codex', model: 'before-commit' },
        routableProviders: ['codex', 'commandcode_work'],
        groups: [
          { id: 'codex', models: [{ id: 'after-commit' }] },
          { id: 'commandcode_work', models: [{ id: 'after-commit' }] },
        ],
      })
      pending.release()
      await expect(intervening).resolves.toBe(fresh)
      expect(cache.read()).toBe(committed)
      expect(adapter.reads).toBe(4)
    } finally {
      pending.release()
      await ctx.fiber.dispose()
    }
  },
)
