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

  it('removes only a manually added model and clears its curation state', () => {
    expect(
      ModelCurationModel.removeAdditionalModel({
        modelId: 'custom-model',
        account: {
          additionalModelIds: ['custom-model', 'other-custom-model'],
          hiddenModelIds: ['custom-model', 'provider-model'],
          favoriteModelIds: ['custom-model', 'provider-model'],
          modelOrder: ['custom-model', 'provider-model', 'other-custom-model'],
          reasoningDefaults: { 'custom-model': 'high', 'provider-model': 'low' },
        },
      }),
    ).toEqual({
      additionalModelIds: ['other-custom-model'],
      hiddenModelIds: ['provider-model'],
      favoriteModelIds: ['provider-model'],
      modelOrder: ['provider-model', 'other-custom-model'],
      reasoningDefaults: { 'provider-model': 'low' },
    })
  })

  it('does not remove a model that was not manually added', () => {
    expect(
      ModelCurationModel.removeAdditionalModel({
        modelId: 'provider-model',
        account: {
          additionalModelIds: [],
          hiddenModelIds: ['provider-model'],
          favoriteModelIds: [],
          modelOrder: ['provider-model'],
          reasoningDefaults: {},
        },
      }),
    ).toBeNull()
  })

  it('marks only additional IDs absent from the provider catalog as removable', () => {
    expect(
      ModelCurationModel.removableAdditionalModelIds({
        catalog: [{ id: 'provider-model', name: 'Provider model', efforts: [], defaultEffort: null }],
        additionalModelIds: ['custom-model', 'provider-model'],
      }),
    ).toEqual(new Set(['custom-model']))
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
