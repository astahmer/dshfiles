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
    // A vendor prefix whose family the rest of the id names says only what the mark says, and drops (round 21 D1):
    // a route provider id such as `dshx_fake_commandcode` serves `deepseek/…` and `google/…` ids.
    expect(modelIdentity('dshx_fake_commandcode', 'deepseek/deepseek-v4-flash')).toEqual({ mark: 'deepseek', name: 'deepseek-v4-flash' })
    expect(modelIdentity('dshx_fake_commandcode', 'google/gemini-3.8-flash')).toEqual({ mark: 'google', name: 'gemini-3.8-flash' })
    expect(modelIdentity('openrouter', 'anthropic/claude-sonnet-5-5')).toEqual({ mark: 'claude', name: 'claude-sonnet-5-5' })
    // Any other prefix stays: it is part of the model's own id (no family, or a different family from the rest).
    expect(modelIdentity('openrouter', 'meta-llama/llama-5-70b')).toEqual({ mark: undefined, name: 'meta-llama/llama-5-70b' })
    expect(modelIdentity('openrouter', 'mistral/step-5-preview')).toEqual({ mark: 'mistral', name: 'mistral/step-5-preview' })
    expect(modelIdentity('openrouter', 'deepseek/')).toEqual({ mark: 'deepseek', name: 'deepseek/' })
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

  it('keeps the 16 px seat for an unknown family with `seat` and draws a neutral chip in it, never an empty slot (round 21 D5, round 34 A3)', () => {
    const seated = renderToStaticMarkup(<RouteModel provider="local" model="step-5-preview" seat />)
    expect(seated).toMatch(
      /^<span data-slot="route-model" data-model-family="none" class="[^"]*dshx:gap-1\.5[^"]*"><span aria-hidden="true" data-model-mark="none" class="dshx:inline-flex dshx:size-4 dshx:shrink-0[^"]*"><svg[^>]*class="lucide lucide-cpu[^"]*dshx:size-3\.5[^"]*dshx:text-faint-foreground[^"]*"[^>]*>.*<\/svg><\/span><span class="dshx:min-w-0 dshx:truncate">step-5-preview<\/span><\/span>$/u,
    )
    // A known family draws the same mark with or without `seat`; no model still renders nothing.
    expect(renderToStaticMarkup(<RouteModel provider="openai-codex" model="gpt-6.2-astra" seat />)).toBe(
      renderToStaticMarkup(<RouteModel provider="openai-codex" model="gpt-6.2-astra" />),
    )
    expect(renderToStaticMarkup(<RouteModel provider="openai" seat />)).toBe('')
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
      // The unknown family's neutral chip is drawn in tertiary ink (neutral 8): a glyph, 3:1 on every fill (round 34 A3).
      expect(PaletteMath.contrastRatio(palette.neutral[8]!, surface), `neutral chip on ${fill}`).toBeGreaterThanOrEqual(3)
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
