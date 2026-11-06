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
