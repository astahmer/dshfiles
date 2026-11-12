import { describe, expect, it } from 'vitest'
import {
  APPEARANCE_BOUNDS,
  DEFAULT_APPEARANCE,
  RUNTIME_DARK_SELECTOR,
  RUNTIME_LIGHT_SELECTOR,
  resolveAppearance,
  runtimeThemeCss,
  THEME_PRESETS,
  type ThemeInput,
} from '../src/theme/appearance.ts'
import { contrastRatio, palette, WARM_STONE, type Scheme } from '../src/theme/palette.ts'
import { syntaxColor } from '../src/theme/theme-css.ts'

const schemes: readonly Scheme[] = ['light', 'dark']
const surfaces = { bg: 0, panel: 1, raised: 2 } as const

/** The P0 AA contract (palette.test.ts) for any generator input. */
function expectAccessible(input: ThemeInput, scheme: Scheme, label: string): void {
  const p = palette({ ...input, scheme })
  for (const [surface, step] of Object.entries(surfaces)) {
    const under = p.neutral[step]!
    for (const text of [9, 10]) expect(contrastRatio(p.neutral[text]!, under), `${label}: step ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(p.neutral[8]!, under), `${label}: step 8 on ${surface}`).toBeGreaterThanOrEqual(3)
    for (const key of ['success', 'warning', 'danger', 'info'] as const) {
      expect(contrastRatio(p[key].fg, under), `${label}: ${key} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrastRatio(p.accent.fg, under), `${label}: accent on ${surface}`).toBeGreaterThanOrEqual(4.5)
  }
  expect(contrastRatio(p.accent.onSolid, p.accent.fg), `${label}: text on a solid accent`).toBeGreaterThanOrEqual(4.5)
  for (const hue of [20, 245, 55, 300, 210])
    expect(contrastRatio(syntaxColor(hue, scheme), p.neutral[1]!), `${label}: syntax ${hue}`).toBeGreaterThanOrEqual(4.5)
}

describe('appearance presets', () => {
  it('starts with warm stone, the P0 default input', () => {
    expect(THEME_PRESETS[0]?.id).toBe('warm-stone')
    expect(resolveAppearance(DEFAULT_APPEARANCE)).toEqual(WARM_STONE)
    expect(resolveAppearance(undefined)).toEqual(WARM_STONE)
  })

  for (const preset of THEME_PRESETS) {
    it.each(schemes)(`${preset.id} keeps WCAG AA for every text step (%s)`, scheme => expectAccessible(preset, scheme, preset.id))
  }

  it.each(schemes)('keeps AA at the corners of the custom bounds (%s)', scheme => {
    for (const hue of [0, 90, 180, 270]) {
      for (const accentHue of [0, 60, 120, 180, 240, 300]) {
        for (const chroma of [APPEARANCE_BOUNDS.chroma.min, APPEARANCE_BOUNDS.chroma.max]) {
          for (const contrast of [APPEARANCE_BOUNDS.contrast.min, APPEARANCE_BOUNDS.contrast.max]) {
            expectAccessible({ hue, chroma, accentHue, contrast }, scheme, JSON.stringify({ hue, chroma, accentHue, contrast }))
          }
        }
      }
    }
  })

  it('applies overrides inside their bounds and ignores non-numbers', () => {
    expect(resolveAppearance({ preset: 'moss', accentHue: 30 })).toEqual({ hue: 135, chroma: 0.013, accentHue: 30, contrast: 1 })
    expect(resolveAppearance({ preset: 'warm-stone', contrast: 9, greyTint: -1 })).toEqual({ ...WARM_STONE, contrast: 1.5, chroma: 0 })
    expect(resolveAppearance({ preset: 'nope' as never })).toEqual(WARM_STONE)
  })
})

describe('runtimeThemeCss', () => {
  it('sets reply prose in a system serif only when chosen, keeping code in the code font (T6.6)', () => {
    expect(runtimeThemeCss({ ...DEFAULT_APPEARANCE, readingFont: 'sans' })).toBe('')
    const css = runtimeThemeCss({ ...DEFAULT_APPEARANCE, readingFont: 'serif' })
    expect(css).toContain('[data-dsh-markdown] :is(p, li, blockquote, h1, h2, h3, h4, h5, h6) {')
    expect(css).toContain('font-family: Charter,')
    expect(css).toContain(':is(code, kbd, samp) {')
    // System faces only: nothing to download.
    expect(css).not.toMatch(/url\(|@font-face/u)
  })
  it('injects nothing for the default, so the static sheet stays the only theme', () => {
    expect(runtimeThemeCss(DEFAULT_APPEARANCE)).toBe('')
    expect(runtimeThemeCss(undefined)).toBe('')
    expect(runtimeThemeCss({ ...DEFAULT_APPEARANCE, greyHue: 65 })).toBe('')
  })

  it('emits both schemes under selectors that out-rank the static block', () => {
    const css = runtimeThemeCss({ ...DEFAULT_APPEARANCE, preset: 'slate-blue' })
    expect(css).toContain(`${RUNTIME_LIGHT_SELECTOR} {`)
    expect(css).toContain(`${RUNTIME_DARK_SELECTOR} {`)
    expect(css).toContain('--dsw-alias-label-primary: var(--dshx-tone-10);')
    expect(css).toContain('--dshx-tone-0: oklch(')
    expect(css).not.toMatch(/font-size/u)
    expect(css).not.toContain('--dsh-font-family')
  })

  it('emits only the font block for a font-only change', () => {
    const css = runtimeThemeCss({ ...DEFAULT_APPEARANCE, interfaceFont: 'system', codeFont: 'system' })
    expect(css.startsWith(':root:root:root {')).toBe(true)
    expect(css).toContain('--dsh-font-family-text-default: -apple-system')
    expect(css).toContain("--dsh-font-family-code-default: 'SF Mono', ui-monospace")
    expect(css).not.toContain('--dshx-tone')
  })
})
