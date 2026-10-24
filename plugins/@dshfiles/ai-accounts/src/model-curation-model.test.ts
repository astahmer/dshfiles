import { describe, expect, it } from 'vitest'
import { ModelCurationModel } from './model-curation-model.js'

describe('model curation catalog', () => {
  it('unhides a model when it is added to favorites', () => {
    expect(
      ModelCurationModel.toggleFavoriteModel({
        modelId: 'hidden-model',
        orderedModelIds: ['available-model', 'hidden-model'],
        favoriteModelIds: [],
        hiddenModelIds: ['hidden-model'],
      }),
    ).toEqual({ favoriteModelIds: ['hidden-model'], hiddenModelIds: [], modelOrder: ['hidden-model', 'available-model'] })
  })

  it('does not change visibility when removing a favorite', () => {
    expect(
      ModelCurationModel.toggleFavoriteModel({
        modelId: 'hidden-model',
        orderedModelIds: ['hidden-model', 'available-model'],
        favoriteModelIds: ['hidden-model'],
        hiddenModelIds: ['hidden-model'],
      }),
    ).toEqual({ favoriteModelIds: [], modelOrder: ['hidden-model', 'available-model'] })
  })

  it('keeps hidden and newly added IDs available to the editor', () => {
    const models = ModelCurationModel.catalogForCuration({
      catalog: [{ id: 'visible-model', name: 'Visible', efforts: [], defaultEffort: null }],
      additionalModelIds: ['custom-model'],
      hiddenModelIds: ['hidden-model'],
    })

    expect(models.map(model => model.id)).toEqual(['visible-model', 'custom-model', 'hidden-model'])
    expect(models.at(-1)).toEqual({ id: 'hidden-model', name: 'hidden-model', efforts: [], defaultEffort: null })
  })

  it('normalizes an optional OpenCode Go or account route prefix', () => {
    expect(ModelCurationModel.parseAdditionalModelId('opencode-go/step-5-preview-free', { instanceId: 'opencode-go-alex', kind: 'opencode-go' })).toBe(
      'step-5-preview-free',
    )
    expect(ModelCurationModel.parseAdditionalModelId('opencode-go-alex/custom-model', { instanceId: 'opencode-go-alex', kind: 'opencode-go' })).toBe(
      'custom-model',
    )
  })

  it('rejects empty, whitespace, and overlong IDs', () => {
    const account = { instanceId: 'opencode-go-alex', kind: 'opencode-go' } as const
    expect(ModelCurationModel.parseAdditionalModelId('  ', account)).toBeNull()
    expect(ModelCurationModel.parseAdditionalModelId('model with spaces', account)).toBeNull()
    expect(ModelCurationModel.parseAdditionalModelId('x'.repeat(121), account)).toBeNull()
  })
})
