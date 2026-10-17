import { describe, expect, it } from 'vitest'
import { ReasoningEffortId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { createCommandCodeProvider } from './commandcode-provider.js'
import { buildProfile, EffortPinnedAdapter } from './provider-profile.js'

const modelsFor = (profile: ReturnType<typeof buildProfile>) => {
  if (profile.piProvider === undefined) throw new Error('The resolved profile must expose its provider.')
  return profile.piProvider.getModels()
}

describe('account provider profiles', () => {
  it.each(['gpt-6.1-sol', 'gpt-6.1-luna', 'gpt-6.1'])('inherits matching GPT family capabilities for %s instead of Spark', async modelId => {
    const profile = buildProfile({
      upstream: openaiCodexProvider(),
      provider: 'codex-emialex',
      displayName: 'CodexEmiAlex',
      additionalModelIds: [modelId, 'gpt-6.1-codex-spark'],
      reasoningDefaults: { [modelId]: 'low' },
    })
    const adapter = new EffortPinnedAdapter(
      {
        profiles: () => new Map([['codex-emialex', profile]]),
        resolveApiKey: async () => undefined,
        auth: {
          credentials: {
            read: async () => undefined,
            list: async () => [],
            modify: async () => undefined,
            delete: async () => undefined,
          },
          authContext: { env: async () => undefined, fileExists: async () => false },
        },
      },
      { reasoningDefaults: new Map() },
    )

    expect(await adapter.resolveModel('codex-emialex', modelId)).toMatchObject({
      inputModalities: ['text', 'image'],
    })
    expect((await adapter.resolveModel('codex-emialex', 'gpt-5.3-codex-spark')).inputModalities).toEqual(['text'])
    expect((await adapter.resolveModel('codex-emialex', 'gpt-6.1-codex-spark')).inputModalities).toEqual(['text'])
  })

  it('publishes each Codex account model pin as that route model default', async () => {
    const modelId = 'gpt-6-luna'
    const profiles = new Map([
      [
        'codex-alex2',
        buildProfile({
          upstream: openaiCodexProvider(),
          provider: 'codex-alex2',
          displayName: 'Codex Alex2',
          additionalModelIds: [modelId],
          reasoningDefaults: { [modelId]: 'max' },
        }),
      ],
      [
        'codex-emialex',
        buildProfile({
          upstream: openaiCodexProvider(),
          provider: 'codex-emialex',
          displayName: 'CodexEmiAlex',
          additionalModelIds: [modelId],
          reasoningDefaults: { [modelId]: 'high' },
        }),
      ],
    ])
    const adapter = new EffortPinnedAdapter(
      {
        profiles: () => profiles,
        resolveApiKey: async () => undefined,
        auth: {
          credentials: {
            read: async () => undefined,
            list: async () => [],
            modify: async () => undefined,
            delete: async () => undefined,
          },
          authContext: { env: async () => undefined, fileExists: async () => false },
        },
      },
      {
        reasoningDefaults: new Map([
          ['codex-alex2', { [modelId]: 'max' }],
          ['codex-emialex', { [modelId]: 'high' }],
        ]),
      },
    )

    await expect(adapter.resolveModel('codex-alex2', modelId)).resolves.toMatchObject({ reasoning: { defaultEffort: 'max' } })
    await expect(adapter.resolveModel('codex-emialex', modelId)).resolves.toMatchObject({ reasoning: { defaultEffort: 'high' } })
  })

  it('uses GitHub Copilot model metadata for each account route', () => {
    const profile = buildProfile({
      upstream: githubCopilotProvider(),
      provider: 'github-copilot-work',
      displayName: 'GitHub Copilot Work',
      additionalModelIds: [],
    })
    const model = modelsFor(profile).find(candidate => candidate.id === 'gpt-6-luna')

    expect(profile.piProvider).toMatchObject({ id: 'github-copilot-work', name: 'GitHub Copilot Work' })
    expect(model).toMatchObject({ provider: 'github-copilot-work', api: 'openai-responses' })
  })

  it('offers a custom OpenCode Go model the catalog already knows and keeps non-favorites available', () => {
    const profile = buildProfile({
      upstream: opencodeGoProvider(),
      provider: 'opencode-go-alex',
      displayName: 'OpenCode Go Alex',
      additionalModelIds: ['step-5-preview-free'],
      favoriteModelIds: ['minimax-m3'],
    })
    const models = modelsFor(profile)

    expect(models.map(model => model.id)).toContain('minimax-m3')
    expect(models.map(model => model.id)).toContain('deepseek-v4.1-flash')
    expect(models.find(model => model.id === 'step-5-preview-free')).toMatchObject({
      api: 'openai-completions',
      id: 'step-5-preview-free',
      name: 'opencode-go-alex/Step 5 Preview Free',
      provider: 'opencode-go-alex',
    })
  })

  it('builds a discovered Command Code model from its own capabilities, not a neighbour', () => {
    const profile = buildProfile({
      upstream: createCommandCodeProvider(),
      provider: 'commandcode-work',
      displayName: 'Command Code Work',
      additionalModelIds: ['zai-org/GLM-5.2', 'vendor/unknown-model'],
    })
    const models = modelsFor(profile)
    const glm = models.find(model => model.id === 'zai-org/GLM-5.2')
    expect(glm).toMatchObject({ api: 'commandcode', provider: 'commandcode-work', reasoning: true, thinkingLevelMap: { low: null, high: 'high', max: 'max' } })
    expect(models.find(model => model.id === 'vendor/unknown-model')).toMatchObject({ api: 'commandcode', reasoning: false })
  })

  it('retries a content-free settlement instead of ending the turn', () => {
    const profile = buildProfile({
      upstream: createCommandCodeProvider(),
      provider: 'commandcode-work',
      displayName: 'Command Code Work',
      additionalModelIds: [],
    })
    expect(profile.retryPolicy).toMatchObject({ mode: 'normal', retryableCodes: expect.arrayContaining(['EMPTY_RESPONSE']) })
  })

  it('removes hidden models from routes while UI fallback retains IDs for recovery', () => {
    const profile = buildProfile({
      upstream: opencodeGoProvider(),
      provider: 'opencode-go-alex',
      displayName: 'OpenCode Go Alex',
      additionalModelIds: [],
      hiddenModelIds: ['deepseek-v4.1-flash'],
    })

    expect(modelsFor(profile).map(model => model.id)).not.toContain('deepseek-v4.1-flash')
  })
})

describe('Codex upstream replay overflow', () => {
  const ENVOY_REPLAY_OVERFLOW = 'exceeded request buffer limit while retrying upstream'
  const claims = btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test' } }))
  const fakeCodexToken = `e30.${claims}.sig`

  const finishOf = async (body: string, status: number) => {
    const profile = buildProfile({ upstream: openaiCodexProvider(), provider: 'codex-test', displayName: 'Codex Test', additionalModelIds: [] })
    const model = modelsFor(profile)[0]
    if (model === undefined) throw new Error('The Codex profile must offer a model.')
    const adapter = new EffortPinnedAdapter(
      {
        profiles: () => new Map([['codex-test', profile]]),
        resolveApiKey: async () => fakeCodexToken,
        auth: {
          credentials: {
            read: async () => ({ type: 'oauth', access: fakeCodexToken, refresh: 'refresh', expires: Date.now() + 3_600_000, accountId: 'acct-test' }),
            list: async () => [],
            modify: async () => undefined,
            delete: async () => undefined,
          },
          authContext: { env: async () => undefined, fileExists: async () => false },
        },
      },
      { reasoningDefaults: new Map() },
    )
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response(body, { status })
    try {
      const chunks: StreamChunk[] = []
      for await (const chunk of adapter.stream({
        provider: 'codex-test',
        model: model.id,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      })) {
        chunks.push(chunk)
      }
      return chunks.at(-1)
    } finally {
      globalThis.fetch = originalFetch
    }
  }

  it('codes the replay overflow as a transport failure so the retry policy sends a fresh request', async () => {
    expect(await finishOf(ENVOY_REPLAY_OVERFLOW, 507)).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'TRANSPORT', message: ENVOY_REPLAY_OVERFLOW } },
    })
  })

  it('keeps an unrelated failure under its own code', async () => {
    expect(await finishOf('{"error":{"message":"unsupported parameter"}}', 400)).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'PI_AI_ERROR', message: 'unsupported parameter' } },
    })
  })
})

describe('OpenCode Go DeepSeek thinking', () => {
  const wireBody = async (model: string, reasoningEffort?: string, upstream = opencodeGoProvider()): Promise<Record<string, unknown>> => {
    const profile = buildProfile({ upstream, provider: 'opencode-go-test', displayName: 'OpenCode Go Test', additionalModelIds: [] })
    const adapter = new EffortPinnedAdapter(
      {
        profiles: () => new Map([['opencode-go-test', profile]]),
        resolveApiKey: async () => 'test-key',
        auth: {
          credentials: { read: async () => undefined, list: async () => [], modify: async () => undefined, delete: async () => undefined },
          authContext: { env: async () => undefined, fileExists: async () => false },
        },
      },
      { reasoningDefaults: new Map() },
    )
    const originalFetch = globalThis.fetch
    let body: Record<string, unknown> = {}
    globalThis.fetch = async (_input, init) => {
      body = JSON.parse(String(init?.body))
      return new Response('{"error":{"message":"stop here"}}', { status: 400 })
    }
    try {
      for await (const _chunk of adapter.stream({
        provider: 'opencode-go-test',
        model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) }),
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      })) {
        // drain
      }
      return body
    } finally {
      globalThis.fetch = originalFetch
    }
  }

  it('offers off on DeepSeek V4.1 Flash with high as its default effort', async () => {
    const profile = buildProfile({ upstream: opencodeGoProvider(), provider: 'opencode-go-test', displayName: 'OpenCode Go Test', additionalModelIds: [] })
    const adapter = new EffortPinnedAdapter(
      {
        profiles: () => new Map([['opencode-go-test', profile]]),
        resolveApiKey: async () => undefined,
        auth: {
          credentials: { read: async () => undefined, list: async () => [], modify: async () => undefined, delete: async () => undefined },
          authContext: { env: async () => undefined, fileExists: async () => false },
        },
      },
      { reasoningDefaults: new Map() },
    )
    const reasoning = (await adapter.resolveModel('opencode-go-test', 'deepseek-v4.1-flash')).reasoning
    expect(reasoning?.efforts.map(effort => effort.id)).toEqual(['off', 'low', 'high', 'max'])
    expect(reasoning?.defaultEffort).toBe('high')
  })

  it('disables thinking only when off is requested', async () => {
    expect(await wireBody('deepseek-v4.1-flash', 'off')).toMatchObject({ thinking: { type: 'disabled' } })
    const omitted = await wireBody('deepseek-v4.1-flash')
    expect(omitted).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'high' })
  })

  it('leaves a DeepSeek model whose catalog already offered off unchanged', async () => {
    const upstream = opencodeGoProvider()
    const catalogOffersOff = upstream
      .getModels()
      .map(model => (model.id === 'deepseek-v4.1-flash' ? { ...model, thinkingLevelMap: { ...model.thinkingLevelMap, off: 'none' } } : model))
    const alreadyOff = { ...upstream, getModels: () => catalogOffersOff }

    expect(await wireBody('deepseek-v4.1-flash', undefined, alreadyOff)).toMatchObject({ thinking: { type: 'disabled' } })
  })
})
