import { describe, expect, it } from 'vitest'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { createCommandCodeProvider } from './commandcode-provider.js'
import { buildProfile } from './provider-profile.js'

const modelsFor = (profile: ReturnType<typeof buildProfile>) => {
  if (profile.piProvider === undefined) throw new Error('The resolved profile must expose its provider.')
  return profile.piProvider.getModels()
}

describe('account provider profiles', () => {
  it('adds custom OpenCode Go models and keeps non-favorites available', () => {
    const profile = buildProfile({
      upstream: opencodeGoProvider(),
      provider: 'opencode-go-alex',
      displayName: 'OpenCode Go Alex',
      additionalModelIds: ['step-5-preview-free'],
      favoriteModelIds: ['minimax-m3'],
    })
    const models = modelsFor(profile)

    expect(models.map(model => model.id)).toContain('minimax-m3')
    expect(models.map(model => model.id)).toContain('deepseek-v4-flash')
    expect(models.find(model => model.id === 'step-5-preview-free')).toMatchObject({
      api: 'openai-completions',
      id: 'step-5-preview-free',
      name: 'opencode-go-alex/step-5-preview-free',
      provider: 'opencode-go-alex',
    })
  })

  it('uses compatible request formats for dynamically discovered Command Code models', () => {
    const profile = buildProfile({
      upstream: createCommandCodeProvider(),
      provider: 'commandcode-work',
      displayName: 'Command Code Work',
      additionalModelIds: ['openai/custom-model', 'anthropic/claude-custom'],
    })
    const models = modelsFor(profile)

    expect(models.find(model => model.id === 'openai/custom-model')?.api).toBe('openai-completions')
    expect(models.find(model => model.id === 'anthropic/claude-custom')?.api).toBe('anthropic-messages')
  })

  it('removes hidden models from routes while UI fallback retains IDs for recovery', () => {
    const profile = buildProfile({
      upstream: opencodeGoProvider(),
      provider: 'opencode-go-alex',
      displayName: 'OpenCode Go Alex',
      additionalModelIds: [],
      hiddenModelIds: ['deepseek-v4-flash'],
    })

    expect(modelsFor(profile).map(model => model.id)).not.toContain('deepseek-v4-flash')
  })
})
