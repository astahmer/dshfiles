import { describe, expect, it } from 'vitest'
import { ModelCurationModel } from './model-curation-model.js'
import { AccountDraftModel } from './account-draft.js'

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

  it('filters after stable order and keeps a real five-row disclosure count', () => {
    const models = Array.from({ length: 9 }, (_, index) => ({ id: `model-${index}`, name: `Model ${index}`, efforts: [], defaultEffort: null }))
    const rows = ModelCurationModel.curationRows(models, ['model-8', 'model-8', 'missing', 'model-1'], '')
    expect(rows.map(model => model.id)).toEqual(['model-8', 'model-1', 'model-0', 'model-2', 'model-3', 'model-4', 'model-5', 'model-6', 'model-7'])
    expect(rows.slice(0, 5)).toHaveLength(5)
    expect(rows.length - 5).toBe(4)
    expect(ModelCurationModel.curationRows(models, ['model-8'], 'Model 7').map(model => model.id)).toEqual(['model-7'])
  })

  it('removes only the selected additional model and its own related overrides', () => {
    const account = {
      ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }),
      additionalModelIds: ['custom', 'keep'],
      hiddenModelIds: ['custom', 'keep'],
      favoriteModelIds: ['custom', 'keep'],
      modelOrder: ['custom', 'keep'],
      reasoningDefaults: { custom: 'low', keep: 'high' },
    }
    expect(ModelCurationModel.removeAdditionalModel(account, 'custom')).toEqual({
      additionalModelIds: ['keep'],
      hiddenModelIds: ['keep'],
      favoriteModelIds: ['keep'],
      modelOrder: ['keep'],
      reasoningDefaults: { keep: 'high' },
    })
    expect(account.reasoningDefaults.custom).toBe('low')
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
