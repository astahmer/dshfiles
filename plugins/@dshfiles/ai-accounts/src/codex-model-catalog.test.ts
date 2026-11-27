import { readFileSync } from 'node:fs'
import { decodeJson, jsonObjectSchema } from '@dshfiles/dshx/json'
import { recordSpans } from '@dshfiles/dshx/tracing'
import type { Credential, OAuthCredential } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { Context, Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { CODEX_MAX_OUTPUT_TOKENS, CodexModelCatalog, type CodexModelsPayload } from './codex-model-catalog.js'
import { isCodexFastModeModel } from './codex-fast-mode.js'
import { ModelCatalogs } from './model-catalogs.js'
import { ModelCatalogsPromiseModel } from './model-catalogs-promise.js'
import { FastModeService } from './codex-fast-mode.js'
import { EffortPinnedAdapter, ProviderProfileModel } from './provider-profile.js'
import { AccountModelSettingsModel } from './account-model-settings.js'
import { AccountsRules } from './api.js'
import type { CodexRoute } from './provider-routes.js'

/** `GET /backend-api/codex/models?client_version=0.200.0`, 2026-11-25, trimmed to the fields DSH reads; no credentials. */
// A type alias, not an interface: the sample must stay assignable to the JSON payload type.
type CodexModelsSample = {
  readonly models: readonly { readonly [key: string]: CodexModelsPayload }[]
}
const fixture = (): CodexModelsSample => {
  return decodeJson(Schema.Struct({ models: Schema.Array(jsonObjectSchema) }), readFileSync(new URL('./fixtures/codex-models.json', import.meta.url), 'utf8'))
}

const codexRoute: CodexRoute = {
  kind: 'codex',
  instanceId: 'codex_work',
  displayName: 'Codex Work',
  enabled: true,
  layout: { mode: 'direct', sharedHomePath: '/tmp/codex-home', effectiveHomePath: '/tmp/codex-home' },
}

const codexProfile = (input: {
  readonly discovered: ReturnType<typeof CodexModelCatalog.parse>
  readonly overrides?: Readonly<Record<string, number>>
  readonly withMaxima?: boolean
}) =>
  ProviderProfileModel.buildProfile({
    upstream: openaiCodexProvider(),
    provider: 'codex_work',
    displayName: 'Codex Work',
    additionalModelIds: [],
    discoveredModels: input.discovered.map(CodexModelCatalog.toDiscovered),
    discoveryRefinesCatalog: true,
    contextWindowOverrides: input.overrides,
    maxContextWindows: new Map(
      input.withMaxima === false
        ? []
        : input.discovered.flatMap(entry => (entry.maxContextWindow === undefined ? [] : [[entry.id, entry.maxContextWindow] as const])),
    ),
  })

const modelsOf = (profile: ReturnType<typeof ProviderProfileModel.buildProfile>) => profile.piProvider?.getModels() ?? []

const credential = (expires: number): OAuthCredential => ({ type: 'oauth', access: 'access-old', refresh: 'refresh-old', expires, accountId: 'acct-test' })

describe('Codex model discovery', () => {
  it('lists only the visible models of the backend sample, with their default and maximum windows', () => {
    const entries = CodexModelCatalog.parse(fixture())
    const ids = entries.map(entry => entry.id)
    expect(ids).toEqual([
      'gpt-6.2-sol',
      'gpt-6.2-astra',
      'gpt-6.1-terra',
      'gpt-6.1-sol',
      'gpt-6-astra',
      'gpt-6-sol',
      'gpt-6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ])
    expect(ids).not.toContain('gpt-reserve')
    expect(ids).not.toContain('codex-auto-review')
    expect(entries.find(entry => entry.id === 'gpt-6.2-astra')).toEqual({
      id: 'gpt-6.2-astra',
      name: 'GPT-6.2-Astra',
      contextWindow: 272_000,
      maxContextWindow: 872_000,
      inputModalities: ['text', 'image'],
      priorityTier: true,
    })
    expect(entries.find(entry => entry.id === 'gpt-6.2-sol')).toMatchObject({ contextWindow: 500_000, maxContextWindow: 872_000 })
    expect(CodexModelCatalog.toDiscovered(entries[1]!)).toEqual({
      id: 'gpt-6.2-astra',
      name: 'GPT-6.2-Astra',
      contextWindow: 272_000,
      maxTokens: CODEX_MAX_OUTPUT_TOKENS,
      inputModalities: ['text', 'image'],
    })
  })

  it('skips an entry that does not decode instead of emptying the list', () => {
    const entries = CodexModelCatalog.parse({ models: [{ slug: 42 }, { slug: 'gpt-x', visibility: 'list', context_window: 'wide' }, ...fixture().models] })
    expect(entries.map(entry => entry.id)).toContain('gpt-6.2-astra')
    expect(entries.map(entry => entry.id)).not.toContain('gpt-x')
  })

  it('offers Fast mode on gpt-6.2 models, which list the same priority tier as gpt-6.1-sol', () => {
    const entries = CodexModelCatalog.parse(fixture())
    for (const id of ['gpt-6.1-sol', 'gpt-6.2-astra', 'gpt-6.2-sol']) {
      expect(entries.find(entry => entry.id === id)?.priorityTier).toBe(true)
      expect(isCodexFastModeModel({ api: 'openai-codex-responses', id })).toBe(true)
    }
  })

  it('sends the Codex CLI headers and records a catalog provider request span without the token', async () => {
    using recorder = recordSpans()
    let seen: Headers | undefined
    let url = ''
    const entries = await CodexModelCatalog.fetch({
      access: 'secret-access-token',
      accountId: 'acct-test',
      signal: new AbortController().signal,
      fetch: async (input, init) => {
        url = String(input)
        seen = new Headers(init?.headers)
        return Response.json(fixture())
      },
    })
    expect(entries.length).toBe(10)
    expect(url).toBe('https://chatgpt.com/backend-api/codex/models?client_version=0.200.0')
    expect(seen?.get('authorization')).toBe('Bearer secret-access-token')
    expect(seen?.get('chatgpt-account-id')).toBe('acct-test')
    expect(seen?.get('originator')).toBe('codex_cli_rs')
    const span = recorder.span('ai-accounts provider request')
    expect(span.attributes).toMatchObject({ 'dshx.ai-accounts.provider': 'codex', 'dshx.ai-accounts.operation': 'catalog', 'http.response.status_code': 200 })
    expect(JSON.stringify(span.attributes)).not.toContain('secret-access-token')
  })

  it('names the recovery when the backend rejects the login', async () => {
    const rejected = CodexModelCatalog.fetch({
      access: 'expired',
      accountId: 'acct-test',
      signal: new AbortController().signal,
      fetch: async () => new Response('{}', { status: 401 }),
    })
    await expect(rejected).rejects.toThrow(/Sign in again from AI Accounts/)
  })

  it('refreshes a stale login through the account store before asking, and leaves a fresh one alone', async () => {
    const now = 1_000_000
    let stored: Credential | undefined = credential(now + 10_000)
    const refreshes: string[] = []
    const store = {
      read: async () => (stored?.type === 'oauth' ? stored : undefined),
      modify: async (mutate: (current: Credential | undefined) => Promise<Credential | undefined>) => {
        stored = await mutate(stored)
        return stored
      },
    }
    const refresh = async (current: OAuthCredential) => {
      refreshes.push(current.refresh)
      return { ...current, access: 'access-new', expires: now + 3_600_000 }
    }
    const signal = new AbortController().signal
    expect(await CodexModelCatalog.credential({ store, refresh, signal, now: () => now })).toEqual({ access: 'access-new', accountId: 'acct-test' })
    expect(refreshes).toEqual(['refresh-old'])
    expect(await CodexModelCatalog.credential({ store, refresh, signal, now: () => now })).toEqual({ access: 'access-new', accountId: 'acct-test' })
    expect(refreshes).toEqual(['refresh-old'])
  })

  it('keeps the static catalog and refines it with the windows the backend reports', () => {
    const entries = CodexModelCatalog.parse(fixture()).map(entry => (entry.id === 'gpt-6.1-sol' ? { ...entry, contextWindow: 640_000 } : entry))
    const models = modelsOf(codexProfile({ discovered: entries }))
    const staticIds = openaiCodexProvider()
      .getModels()
      .map(model => model.id)
    for (const id of staticIds) expect(models.map(model => model.id)).toContain(id)
    expect(models.find(model => model.id === 'gpt-6.1-sol')?.contextWindow).toBe(640_000)
    expect(models.find(model => model.id === 'gpt-6.2-astra')?.contextWindow).toBe(272_000)
  })

  // Regression: before Codex discovery a plan model pi-ai's catalog lacks was missing, or took its template's window.
  it('offers a listed model absent from the static catalog as a complete Codex model with the backend window', () => {
    const sample = fixture()
    const next = {
      ...sample.models.find(model => model.slug === 'gpt-6.2-astra'),
      slug: 'gpt-6.3-astra',
      display_name: 'GPT-6.3-Astra',
      context_window: 400_000,
    }
    const entries = CodexModelCatalog.parse({ models: [next, ...sample.models] })
    const model = modelsOf(codexProfile({ discovered: entries })).find(candidate => candidate.id === 'gpt-6.3-astra')
    expect(model).toMatchObject({
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
      reasoning: true,
      contextWindow: 400_000,
      maxTokens: 128_000,
      input: ['text', 'image'],
    })
    const astra = openaiCodexProvider()
      .getModels()
      .find(candidate => candidate.id === 'gpt-6.2-astra')
    expect(model?.thinkingLevelMap).toEqual(astra?.thinkingLevelMap)
  })

  it('applies a window override clamped to the backend maximum, and DSH resolves the clamped window', async () => {
    const entries = CodexModelCatalog.parse(fixture())
    const clamped = codexProfile({ discovered: entries, overrides: { 'gpt-6.2-astra': 2_000_000, 'gpt-6.2-sol': 600_000 } })
    expect(modelsOf(clamped).find(model => model.id === 'gpt-6.2-astra')?.contextWindow).toBe(872_000)
    expect(modelsOf(clamped).find(model => model.id === 'gpt-6.2-sol')?.contextWindow).toBe(600_000)
    const unknownMax = codexProfile({ discovered: entries, overrides: { 'gpt-6.2-astra': 2_000_000 }, withMaxima: false })
    expect(modelsOf(unknownMax).find(model => model.id === 'gpt-6.2-astra')?.contextWindow).toBe(2_000_000)

    const adapter = new EffortPinnedAdapter(
      {
        profiles: () => new Map([['codex_work', clamped]]),
        resolveApiKey: async () => undefined,
        auth: {
          credentials: { read: async () => undefined, list: async () => [], modify: async () => undefined, delete: async () => undefined },
          authContext: { env: async () => undefined, fileExists: async () => false },
        },
      },
      { reasoningDefaults: new Map(), fastMode: new FastModeService({ isAvailable: () => false, isLiveSession: () => true, isEnabledByDefault: () => false }) },
    )
    expect((await adapter.resolveModel('codex_work', 'gpt-6.2-astra')).context?.contextWindow).toBe(872_000)
  })

  it('saves an override at the maximum, clears it with null, and shows the limit in the catalog', () => {
    const write = AccountModelSettingsModel.contextWindowWrite({ current: { other: 300_000 }, modelId: 'gpt-6.2-astra', requested: 1_000_000, max: 872_000 })
    expect(write).toEqual({ overrides: { other: 300_000, 'gpt-6.2-astra': 872_000 }, saved: 872_000, clamped: true })
    const cleared = AccountModelSettingsModel.contextWindowWrite({ current: write.overrides, modelId: 'gpt-6.2-astra', requested: null, max: 872_000 })
    expect(cleared).toEqual({ overrides: { other: 300_000 }, saved: null, clamped: false })

    const fields = AccountModelSettingsModel.contextWindowFields({ contextWindow: 272_000, maxContextWindow: 872_000, override: 500_000 })
    expect(fields).toEqual({ contextWindow: 272_000, maxContextWindow: 872_000, contextWindowOverride: 500_000, effectiveContextWindow: 500_000 })
    expect(AccountsRules.contextWindowSummary(fields)).toBe(' · context 500k (default 272k, override 500k, max 872k)')
    expect(AccountsRules.contextWindowSummary({ contextWindow: 272_000, maxContextWindow: 872_000 })).toBe(' · context 272k (max 872k)')
    expect(AccountModelSettingsModel.contextWindowChoices({ contextWindow: 272_000, maxContextWindow: 872_000 })).toEqual([
      128_000, 200_000, 272_000, 400_000, 500_000, 600_000, 750_000, 872_000,
    ])
    expect(AccountModelSettingsModel.contextWindowChoices({ contextWindow: 272_000, maxContextWindow: undefined })).toEqual([])
  })

  it('keeps the previous model list when a refresh fails', async () => {
    const catalogs = Effect.runSync(ModelCatalogs.make)
    const facade = ModelCatalogsPromiseModel.facade(catalogs, Context.empty())
    const previous = CodexModelCatalog.parse(fixture()).map(CodexModelCatalog.toDiscovered)
    facade.record({ instanceId: 'codex_work', route: codexRoute, models: previous })
    const result = await facade.refresh('codex_work', signal =>
      CodexModelCatalog.fetch({ access: 'a', accountId: 'b', signal, fetch: async () => new Response('busy', { status: 503 }) }).then(entries =>
        entries.map(CodexModelCatalog.toDiscovered),
      ),
    )
    expect(result).toBeUndefined()
    expect(facade.discovered('codex_work')).toEqual(previous)
  })
})
