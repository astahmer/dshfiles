import { describe, expect, it } from 'vitest'
import { catalogForCuration, parseAdditionalModelId } from './model-curation-model.js'

describe('model curation catalog', () => {
  it('keeps hidden and newly added IDs available to the editor', () => {
    const models = catalogForCuration({
      catalog: [{ id: 'visible-model', name: 'Visible', efforts: [], defaultEffort: null }],
      additionalModelIds: ['custom-model'],
      hiddenModelIds: ['hidden-model'],
    })

    expect(models.map(model => model.id)).toEqual(['visible-model', 'custom-model', 'hidden-model'])
    expect(models.at(-1)).toEqual({ id: 'hidden-model', name: 'hidden-model', efforts: [], defaultEffort: null })
  })

  it('normalizes an optional OpenCode Go or account route prefix', () => {
    expect(parseAdditionalModelId('opencode-go/step-5-preview-free', { instanceId: 'opencode-go-alex', kind: 'opencode-go' })).toBe('step-5-preview-free')
    expect(parseAdditionalModelId('opencode-go-alex/custom-model', { instanceId: 'opencode-go-alex', kind: 'opencode-go' })).toBe('custom-model')
  })

  it('rejects empty, whitespace, and overlong IDs', () => {
    const account = { instanceId: 'opencode-go-alex', kind: 'opencode-go' } as const
    expect(parseAdditionalModelId('  ', account)).toBeNull()
    expect(parseAdditionalModelId('model with spaces', account)).toBeNull()
    expect(parseAdditionalModelId('x'.repeat(121), account)).toBeNull()
  })
})
