import { describe, expect, it } from 'vitest'
import { createMistralProvider } from './mistral-provider.js'
import { VibeCliSessions } from './vibe-cli.js'
import { VibeAcpSessions } from './vibe-acp.js'
import { createVibeAcpProvider, createVibeProvider } from './vibe-provider.js'

const provider = createVibeProvider({
  upstream: createMistralProvider(),
  sessions: new VibeCliSessions({ home: () => '/synthetic/vibe' }),
})

describe('the Vibe provider catalog', () => {
  it('publishes the CLI catalog as one route over the cli transport', () => {
    expect(provider.id).toBe('vibe')
    expect(provider.getModels().map(model => model.id)).toEqual([
      'mistral-large-4-0',
      'mistral-medium-latest',
      'zai-glm-5-3',
      'zai-glm-5-3-flash',
      'deepseek-v4-1-flash-1017',
    ])
    for (const model of provider.getModels()) expect(model).toMatchObject({ api: 'vibe-cli', provider: 'vibe', reasoning: true })
  })

  it("keeps each model's own context window, vision input and thinking levels", () => {
    const medium = provider.getModels().find(model => model.id === 'mistral-medium-latest')
    const large = provider.getModels().find(model => model.id === 'mistral-large-4-0')
    const glm = provider.getModels().find(model => model.id === 'zai-glm-5-3')
    expect(medium).toMatchObject({ contextWindow: 262_144, input: ['text', 'image'] })
    expect(medium?.thinkingLevelMap).toMatchObject({ high: 'high', low: null })
    expect(large).toMatchObject({ contextWindow: 1_048_576, input: ['text', 'image'] })
    expect(large?.thinkingLevelMap).toMatchObject({ medium: 'medium', max: null })
    expect(glm?.input).toEqual(['text'])
    expect(glm?.thinkingLevelMap).toMatchObject({ max: 'max' })
  })
})

describe('the Vibe ACP provider catalog', () => {
  const acp = createVibeAcpProvider({
    upstream: createMistralProvider(),
    sessions: new VibeAcpSessions({
      processes: { launch: () => ({ send: () => undefined, stop: async () => undefined }), after: () => () => undefined },
      home: () => '/synthetic/vibe',
    }),
  })

  it('publishes the same catalog under the ACP api, so a bridged account picks the same models', () => {
    expect(acp.id).toBe('vibe')
    expect(acp.getModels().map(model => model.id)).toEqual(provider.getModels().map(model => model.id))
    for (const model of acp.getModels()) expect(model).toMatchObject({ api: 'vibe-acp', provider: 'vibe', reasoning: true })
  })
})

describe('the Vibe account profile', () => {
  it('builds the host profile the account route registers, under its own provider id', async () => {
    const { ProviderProfileModel } = await import('./provider-profile.js')
    const profile = ProviderProfileModel.buildProfile({
      upstream: provider,
      provider: 'vibe_work',
      displayName: 'Vibe CLI 1',
      additionalModelIds: [],
    })
    const models = profile.piProvider?.getModels() ?? []
    expect(models.map(model => model.id)).toEqual(provider.getModels().map(model => model.id))
    expect(new Set(models.map(model => model.provider))).toEqual(new Set(['vibe_work']))
  })
})
