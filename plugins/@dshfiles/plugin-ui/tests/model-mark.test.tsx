import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelMark, NativeProviderMark, modelFamily } from '../src/components/model-mark.js'

describe('Kit model marks (council round 5 D1: one brand mark for AI accounts and Usage)', () => {
  it('names the family of a model id from its tokens', () => {
    expect(modelFamily('gpt-6-luna')).toBe('openai')
    expect(modelFamily('o3')).toBe('openai')
    expect(modelFamily('deepseek/deepseek-v4-flash')).toBe('deepseek')
    expect(modelFamily('claude-sonnet-5-5')).toBe('claude')
    expect(modelFamily('google/gemini-3.8-flash')).toBe('google')
    expect(modelFamily('mistral-large-4')).toBe('mistral')
    expect(modelFamily('step-5-preview')).toBeUndefined()
  })

  it('draws a 16 px provider mark before a model id, and an empty seat of the same size for an unknown family', () => {
    for (const id of ['gpt-6-luna', 'deepseek/deepseek-v4-flash', 'claude-sonnet-5-5', 'google/gemini-3.8-flash', 'mistral-large-4']) {
      const markup = renderToStaticMarkup(<ModelMark modelId={id} />)
      expect(markup, id).toMatch(/^<span aria-hidden="true" data-model-mark="[a-z]+" class="[^"]*dshx:size-4[^"]*"><svg/u)
      // The mark is decoration beside a visible name: the glyph carries no second accessible name.
      expect(markup, id).not.toContain('aria-label')
    }
    expect(renderToStaticMarkup(<ModelMark modelId="step-5-preview" />)).toMatch(
      /^<span aria-hidden="true" data-model-mark="none" class="[^"]*dshx:size-4[^"]*"><\/span>$/u,
    )
  })

  it('draws each family in its brand colour', () => {
    expect(renderToStaticMarkup(<ModelMark modelId="gpt-6-luna" />)).toContain('color:#10A37F')
    expect(renderToStaticMarkup(<ModelMark modelId="claude-sonnet-5-5" />)).toContain('color:#D97757')
  })

  it('gives the DeepSeek built-in providers the DeepSeek mark on a 32 px tile instead of a generic cube', () => {
    const deepseek = renderToStaticMarkup(<NativeProviderMark label="DeepSeek Account" />)
    expect(deepseek).toContain('data-native-provider-mark="deepseek"')
    expect(deepseek).toContain('dshx:size-8')
    expect(deepseek).not.toContain('lucide-box')
    expect(renderToStaticMarkup(<NativeProviderMark label="Local runtime" />)).toContain('lucide-box')
  })
})
