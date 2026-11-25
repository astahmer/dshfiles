import { describe, expect, it } from 'vitest'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'
import { ThemeCss } from '../src/theme/theme-css.ts'

const schemes: readonly Scheme[] = ['light', 'dark']

describe('primary button fill (council round 3 A3)', () => {
  it('stays the ink in light and is a softened warm light grey in dark, below the ink', () => {
    const light = PaletteMath.palette({ ...WARM_STONE, scheme: 'light' })
    const dark = PaletteMath.palette({ ...WARM_STONE, scheme: 'dark' })
    expect(light.primaryFill).toEqual(light.neutral[10])
    expect(dark.primaryFill).toEqual({ l: 0.88, c: 0.006, h: 65 })
    // No longer the brightest thing on a dark screen: dimmer than the ink.
    expect(dark.primaryFill.l).toBeLessThan(dark.neutral[10]!.l)
    // It follows the preset's grey hue.
    expect(PaletteMath.palette({ ...WARM_STONE, hue: 250, scheme: 'dark' }).primaryFill.h).toBe(250)
  })

  it.each(schemes)('keeps its label (the page colour) at AA at rest and on hover (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const label = p.neutral[0]!
    expect(PaletteMath.contrastRatio(label, p.primaryFill)).toBeGreaterThanOrEqual(4.5)
    // Hover: 86% of the fill toward the page.
    const hover = { l: p.primaryFill.l * 0.86 + label.l * 0.14, c: p.primaryFill.c, h: p.primaryFill.h }
    expect(PaletteMath.contrastRatio(label, hover)).toBeGreaterThanOrEqual(4.5)
  })

  it('reaches the Host and kit primary through brand-primary, light unchanged', () => {
    const light = ThemeCss.blockDeclarations(WARM_STONE, 'light').join('\n')
    const dark = ThemeCss.blockDeclarations(WARM_STONE, 'dark').join('\n')
    expect(dark).toContain('--dshx-primary-fill: oklch(0.88 0.006 65);')
    expect(dark).toContain('--dsw-alias-brand-primary: var(--dshx-primary-fill);')
    expect(dark).toContain('--dsw-alias-button-primary-hover: color-mix(in oklch, var(--dshx-primary-fill) 86%, var(--dshx-tone-0));')
    expect(light).toContain('--dsw-alias-brand-primary: var(--dshx-tone-10);')
    expect(light).toContain('--dsw-alias-button-primary-hover: color-mix(in oklch, var(--dshx-tone-10) 86%, var(--dshx-tone-0));')
  })
})
