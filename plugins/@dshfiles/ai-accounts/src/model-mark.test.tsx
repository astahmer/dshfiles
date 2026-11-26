import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModelMark, NativeProviderMark, modelFamily } from '@dshfiles/plugin-ui/components/model-mark'
import { ProviderGlyph } from './panel-primitives.js'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('AI accounts marks (council round 2, D4)', () => {
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
    for (const id of ['gpt-6-luna', 'deepseek/deepseek-v4-flash', 'claude-sonnet-5-5', 'google/gemini-3.8-flash']) {
      const markup = renderToStaticMarkup(<ModelMark modelId={id} />)
      expect(markup, id).toMatch(/^<span aria-hidden="true" data-model-mark="[a-z]+" class="[^"]*dshx:size-4[^"]*"><svg/u)
    }
    expect(renderToStaticMarkup(<ModelMark modelId="step-5-preview" />)).toMatch(
      /^<span aria-hidden="true" data-model-mark="none" class="[^"]*dshx:size-4[^"]*"><\/span>$/u,
    )
  })

  it('gives the DeepSeek built-in providers the DeepSeek mark instead of a generic cube', () => {
    const deepseek = renderToStaticMarkup(<NativeProviderMark label="DeepSeek Account" />)
    expect(deepseek).toContain('data-native-provider-mark="deepseek"')
    expect(deepseek).not.toContain('lucide-box')
    expect(renderToStaticMarkup(<NativeProviderMark label="Local runtime" />)).toContain('lucide-box')
    expect(read('native-providers-list.tsx')).toContain('<NativeProviderMark label={provider.label} size="list" />')
    expect(read('native-providers-list.tsx')).not.toContain('<BoxIcon')
  })

  it('draws rail tiles at 28 px (council round 5, D2) in a 260\u2013300 px list column', () => {
    expect(renderToStaticMarkup(<ProviderGlyph kind="commandcode" list />)).toContain('dshx:size-7')
    expect(renderToStaticMarkup(<NativeProviderMark label="DeepSeek" size="list" />)).toContain('dshx:size-7')
    expect(read('accounts-panel.tsx')).toContain('dshx:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]')
  })

  it('heads the picker column "Show model" (council round 9, D3) and leaves an inherited source as quiet text', () => {
    const table = read('model-curation.tsx')
    expect(table).toContain('>Show model</th>')
    expect(table).toContain('<ModelMark modelId={model.id} />')
    expect(table).toContain("overridden ? 'dshx:rounded-full dshx:bg-accent dshx:px-2 dshx:py-1 dshx:text-accent-foreground' : 'dshx:text-muted-foreground'")
  })
})
