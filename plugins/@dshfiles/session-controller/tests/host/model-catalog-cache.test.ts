import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import LlmRuntime, { LlmAdapter, type LlmModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it } from 'vitest'
import { SessionModelCatalog } from '../../src/native/catalog.ts'

const contexts = new Set<Context>()
afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
})

class CatalogAdapter extends LlmAdapter {
  model = 'gpt-6-luna'
  reads = 0
  gate: Promise<void> | undefined

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    this.reads += 1
    const id = this.model
    await this.gate
    return [{ provider, id, name: id }]
  }

  override stream(): AsyncIterable<StreamChunk> {
    throw new Error('Catalog tests never stream a model request.')
  }
}

const harness = async () => {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(LlmRuntime)
  let selection = { provider: 'codex', model: 'gpt-6-luna' }
  // SAFETY: catalog reads only currentSelection from the deployment-default service.
  ctx.provide('agentDefaultModel', { currentSelection: () => selection } as never)
  const adapter = new CatalogAdapter()
  const registration = ctx.llm.registerAdapter(['codex'], adapter)
  const cache = new SessionModelCatalog(ctx)
  return {
    ctx,
    adapter,
    registration,
    cache,
    setDefault: (next: typeof selection) => {
      selection = next
    },
  }
}

it('reuses one in-flight and settled snapshot while its inputs are unchanged', async () => {
  const { cache, adapter } = await harness()
  const first = cache.read()
  expect(cache.read()).toBe(first)
  await expect(first).resolves.toMatchObject({ routableProviders: ['codex'] })
  expect(cache.read()).toBe(first)
  expect(adapter.reads).toBe(1)
})

it('immediately advertises a newly registered account and its renamed route', async () => {
  const { ctx, adapter, cache } = await harness()
  await cache.read()
  const account = ctx.llm.registerAdapter(['commandcode_1'], adapter)
  await expect(cache.read()).resolves.toMatchObject({ routableProviders: ['codex', 'commandcode_1'] })
  account.replace(['commandcode_work'])
  await expect(cache.read()).resolves.toMatchObject({ routableProviders: ['codex', 'commandcode_work'] })
  account()
  await expect(cache.read()).resolves.toMatchObject({ routableProviders: ['codex'] })
})

it('invalidates same-id model changes announced by a configurable-provider update', async () => {
  const { ctx, adapter, cache } = await harness()
  const entry = { provider: 'codex', displayName: 'Codex', settingsNs: 'codex', settingsPath: [] }
  const directory = ctx.llm.registerConfigurableProviders([entry])
  await cache.read()
  adapter.model = 'gpt-new'
  directory.replace([entry])
  await expect(cache.read()).resolves.toMatchObject({ groups: [{ models: [{ id: 'gpt-new' }] }] })
})

it('does not let an older in-flight snapshot poison reads after route commit', async () => {
  const { ctx, adapter, cache } = await harness()
  let release: () => void = () => {}
  adapter.gate = new Promise<void>(resolve => {
    release = resolve
  })
  const old = cache.read()
  await Promise.resolve()
  expect(adapter.reads).toBe(1)
  adapter.gate = undefined
  ctx.llm.registerAdapter(['commandcode_work'], adapter)
  const current = cache.read()
  expect(current).not.toBe(old)
  await expect(current).resolves.toMatchObject({ routableProviders: ['codex', 'commandcode_work'] })
  release()
  // The combined coordinator strengthens the old contract: already-waiting readers
  // now share the committed snapshot too, rather than merely avoiding cache poisoning.
  await expect(old).resolves.toBe(await current)
  expect(cache.read()).toBe(current)
})

it.each(['settings/document-updated', 'credentials/record-updated', 'credentials/reference-updated'] as const)(
  'invalidates %s without eagerly rebuilding before its owner commits',
  async event => {
    const { ctx, adapter, cache, registration } = await harness()
    const before = cache.read()
    await before
    if (event === 'settings/document-updated') ctx.emit(event, brandString<SettingsNamespace>('codex'), 1)
    else if (event === 'credentials/record-updated') ctx.emit(event, credentialKey('ai-accounts', 'codex'))
    else ctx.emit(event, credentialRef('E2E_ACCOUNT_KEY'))
    expect(adapter.reads).toBe(1)
    const intervening = cache.read()
    expect(intervening).not.toBe(before)
    await intervening
    // A pre-publication credential read is not the final generation: account route
    // replacement publishes its own later adapter update, even when ids stay equal.
    adapter.model = 'gpt-after-commit'
    registration.replace(['codex'])
    const committed = cache.read()
    expect(committed).not.toBe(intervening)
    await expect(committed).resolves.toMatchObject({ groups: [{ models: [{ id: 'gpt-after-commit' }] }] })
  },
)

it('keys the snapshot by the deployment default as well as provider inputs', async () => {
  const { cache, setDefault } = await harness()
  const first = cache.read()
  await first
  setDefault({ provider: 'codex', model: 'gpt-new' })
  const second = cache.read()
  expect(second).not.toBe(first)
  await expect(second).resolves.toMatchObject({ default: { provider: 'codex', model: 'gpt-new' } })
})
