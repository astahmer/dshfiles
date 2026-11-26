import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RouteModel, modelIdentity } from '../src/components/model-mark.js'
import { BRAND_COLOURS } from '../src/theme/brand-colours.js'
import { PaletteMath, WARM_STONE } from '../src/theme/palette.ts'

describe('A route model identity (council round 17 A1: the subagent model is easy to read)', () => {
  it('names the model as the picker does and marks its family, never guessing', () => {
    expect(modelIdentity('openai-codex', 'gpt-6.2-astra')).toEqual({ mark: 'openai', name: 'gpt-6.2-astra' })
    expect(modelIdentity('claude-code', 'claude-opus-5-5')).toEqual({ mark: 'claude', name: 'claude-opus-5-5' })
    // An account provider prefixes its model ids with its own id; under its provider the prefix says nothing.
    expect(modelIdentity('deepseek', 'deepseek/deepseek-v4-flash')).toEqual({ mark: 'deepseek', name: 'deepseek-v4-flash' })
    // Another prefix stays: it is part of the model's own id.
    expect(modelIdentity('openrouter', 'anthropic/claude-sonnet-5-5')).toEqual({ mark: 'claude', name: 'anthropic/claude-sonnet-5-5' })
    // The provider names the family when the model id does not.
    expect(modelIdentity('anthropic', 'opus-next')).toEqual({ mark: 'claude', name: 'opus-next' })
    // No token names a family: the name alone, no mark.
    expect(modelIdentity('local', 'step-5-preview')).toEqual({ mark: undefined, name: 'step-5-preview' })
    // No model: nothing to show; a provider id is not a model name.
    expect(modelIdentity('openai', undefined)).toBeUndefined()
    expect(modelIdentity('openai', '  ')).toBeUndefined()
    expect(modelIdentity(undefined, undefined)).toBeUndefined()
    expect(modelIdentity(undefined, ' gpt-6.2-astra ')).toEqual({ mark: 'openai', name: 'gpt-6.2-astra' })
  })

  it('draws the 16 px mark and the truncating name in secondary ink, 12 px by default and 13 px at md', () => {
    const markup = renderToStaticMarkup(<RouteModel provider="openai-codex" model="gpt-6.2-astra" />)
    expect(markup).toMatch(/^<span data-slot="route-model" data-model-family="openai" class="[^"]*dshx:text-muted-foreground[^"]*dshx:text-xs\/4[^"]*">/u)
    expect(markup).toMatch(/<span aria-hidden="true" data-model-mark="openai" class="[^"]*dshx:size-4[^"]*dshx:shrink-0[^"]*"><svg/u)
    expect(markup).toContain('<span class="dshx:min-w-0 dshx:truncate">gpt-6.2-astra</span>')
    expect(renderToStaticMarkup(<RouteModel provider="openai-codex" model="gpt-6.2-astra" size="md" />)).toMatch(/class="[^"]*dshx:text-sm[ "]/u)
  })

  it('draws no mark seat for an unknown family, and nothing at all without a model', () => {
    const unknown = renderToStaticMarkup(<RouteModel provider="local" model="step-5-preview" />)
    expect(unknown).not.toContain('data-model-mark')
    expect(unknown).toContain('>step-5-preview</span>')
    expect(renderToStaticMarkup(<RouteModel provider="openai" />)).toBe('')
  })

  const fills = ['bg', 'panel', 'raised', 'selected'] as const
  const darken = (hex: string, factor: number): string => {
    const channel = (offset: number): string =>
      Math.round(Number.parseInt(hex.slice(offset, offset + 2), 16) * factor)
        .toString(16)
        .padStart(2, '0')
    return `#${channel(1)}${channel(3)}${channel(5)}`
  }

  it.each(['light', 'dark'] as const)('holds AA for the name and 3:1 for every mark on bg, panel, raised and selected (%s)', scheme => {
    const palette = PaletteMath.palette({ ...WARM_STONE, scheme })
    // The mark is drawn at 85% brightness in light (`brightness-85`), the brand colour in dark (`dark:brightness-100`).
    const factor = scheme === 'light' ? 0.85 : 1
    for (const [index, fill] of fills.entries()) {
      const surface = palette.neutral[index]!
      expect(PaletteMath.contrastRatio(palette.neutral[9]!, surface), `secondary ink on ${fill}`).toBeGreaterThanOrEqual(4.5)
      for (const [family, hex] of Object.entries(BRAND_COLOURS))
        expect(PaletteMath.contrastRatio(PaletteMath.hexToOklch(darken(hex, factor)), surface), `${family} mark on ${fill}`).toBeGreaterThanOrEqual(3)
    }
    if (scheme === 'light')
      // Without the light deepening the marks miss 3:1 on the washes: the class is load-bearing.
      expect(PaletteMath.contrastRatio(PaletteMath.hexToOklch(BRAND_COLOURS.claude), palette.neutral[3]!)).toBeLessThan(3)
  })

  it('deepens the mark in light only', () => {
    const markup = renderToStaticMarkup(<RouteModel model="claude-opus-5-5" />)
    expect(markup).toMatch(/data-model-mark="claude" class="[^"]*dshx:brightness-85 dshx:dark:brightness-100/u)
  })
})
