import { describe, expect, it } from 'vitest'
import { createMistralProvider } from './mistral-provider.js'

const provider = createMistralProvider()
const catalogModel = (id: string) => provider.getModels().find(model => model.id === id)

describe('Mistral reasoning efforts', () => {
  it('offers each Mistral model the reasoning efforts Mistral accepts', () => {
    expect(catalogModel('mistral-large-4')).toMatchObject({
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null },
    })
    for (const id of ['zai-glm-5-3-flash', 'zai-glm-latest', 'deepseek-v4-1-flash-1017']) {
      expect(provider.describeModel(id)).toMatchObject({
        id,
        reasoning: true,
        thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' },
      })
    }
  })

  it('keeps pi-ai levels for a model the table does not list', () => {
    expect(catalogModel('mistral-small-latest')?.thinkingLevelMap).toMatchObject({ off: 'none', high: 'high' })
    expect(provider.describeModel('mistral-vibe-cli-latest')?.thinkingLevelMap).toMatchObject({ off: 'none', high: 'high' })
  })
})

describe('Mistral image input', () => {
  it('offers image input on every model Mistral documents as reading images', () => {
    expect(catalogModel('mistral-large-4')?.input).toEqual(['text', 'image'])
    for (const id of ['zai-glm-5-3-flash', 'deepseek-v4-1-flash-1017']) expect(provider.describeModel(id)?.input).toEqual(['text', 'image'])
    // A catalog entry that leaves vision out cannot hide it.
    for (const id of ['zai-glm-5-3-flash', 'mistral-large-4-0'])
      expect(provider.describeModel(id, { id, inputModalities: ['text'] })?.input).toEqual(['text', 'image'])
    // GLM 5.3 itself is a text model.
    expect(catalogModel('zai-glm-5-3')?.input).toEqual(['text'])
  })
})

describe('Mistral-hosted models pi-ai does not catalog', () => {
  it('catalogs DeepSeek V4.1 Flash 1017 as Mistral documents it', () => {
    expect(catalogModel('deepseek-v4-1-flash-1017')).toMatchObject({
      name: 'DeepSeek V4.1 Flash 1017',
      provider: 'mistral',
      input: ['text', 'image'],
      contextWindow: 1_048_576,
      maxTokens: 131_072,
      cost: { input: 0.3, output: 1.2, cacheRead: 0.007, cacheWrite: 0 },
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' },
    })
    expect(provider.getModels().filter(model => model.id === 'deepseek-v4-1-flash-1017')).toHaveLength(1)
  })
})
