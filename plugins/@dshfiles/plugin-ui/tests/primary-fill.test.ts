import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buttonVariants } from '../src/components/ui/button.tsx'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'
import { ThemeCss } from '../src/theme/theme-css.ts'

const schemes: readonly Scheme[] = ['light', 'dark']
// Vitest runs each package from its root.
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')

describe('primary button fill (council round 3 A3, round 4 A2)', () => {
  it('is a soft warm near-black in light that darkens on hover, and a softened warm light grey in dark', () => {
    const light = PaletteMath.palette({ ...WARM_STONE, scheme: 'light' })
    const dark = PaletteMath.palette({ ...WARM_STONE, scheme: 'dark' })
    // Round 4 A2: oklch(0.30 0.01 h), hover oklch(0.24 0.01 h), on the preset's grey hue (65 for warm stone).
    expect(light.primaryFill).toEqual({ l: 0.3, c: 0.01, h: 65 })
    expect(light.primaryHover).toEqual({ l: 0.24, c: 0.01, h: 65 })
    expect(dark.primaryFill).toEqual({ l: 0.88, c: 0.006, h: 65 })
    // Dark hover: 86% of the fill toward the page, as before.
    expect(dark.primaryHover.l).toBeCloseTo(0.88 * 0.86 + dark.neutral[0]!.l * 0.14, 4)
    // No longer the brightest thing on a dark screen: dimmer than the ink.
    expect(dark.primaryFill.l).toBeLessThan(dark.neutral[10]!.l)
    // It follows the preset's grey hue, and a neutral preset keeps it grey.
    expect(PaletteMath.palette({ ...WARM_STONE, hue: 250, scheme: 'dark' }).primaryFill.h).toBe(250)
    expect(PaletteMath.palette({ ...WARM_STONE, hue: 250, scheme: 'light' }).primaryFill.h).toBe(250)
    expect(PaletteMath.palette({ ...WARM_STONE, chroma: 0, scheme: 'light' }).primaryFill.c).toBe(0)
  })

  it.each(schemes)('keeps its label (the page colour) at AA at rest and on hover (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const label = p.neutral[0]!
    expect(PaletteMath.contrastRatio(label, p.primaryFill)).toBeGreaterThanOrEqual(4.5)
    expect(PaletteMath.contrastRatio(label, p.primaryHover)).toBeGreaterThanOrEqual(4.5)
  })

  it('reaches the Host and kit primary and its hover through one pair of tokens', () => {
    const light = ThemeCss.blockDeclarations(WARM_STONE, 'light').join('\n')
    const dark = ThemeCss.blockDeclarations(WARM_STONE, 'dark').join('\n')
    expect(light).toContain('--dshx-primary-fill: oklch(0.3 0.01 65);')
    expect(light).toContain('--dshx-primary-hover: oklch(0.24 0.01 65);')
    expect(dark).toContain('--dshx-primary-fill: oklch(0.88 0.006 65);')
    for (const block of [light, dark]) {
      expect(block).toContain('--dsw-alias-brand-primary: var(--dshx-primary-fill);')
      expect(block).toContain('--dsw-alias-button-primary-hover: var(--dshx-primary-hover);')
    }
    expect(styles).toContain('--color-primary-hover: var(--dshx-primary-hover);')
    const primary = buttonVariants({ variant: 'default' }).split(/\s+/u)
    expect(primary).toContain('dshx:hover:bg-primary-hover')
    expect(primary).toContain('dshx:font-medium')
  })
})
