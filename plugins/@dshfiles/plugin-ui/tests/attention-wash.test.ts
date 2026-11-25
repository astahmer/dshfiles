import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'
import { ThemeCss } from '../src/theme/theme-css.ts'

// Vitest runs each package from its root; jsdom gives import.meta.url a non-file scheme here.
const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
const schemes: readonly Scheme[] = ['light', 'dark']

describe('attention washes (round five A2)', () => {
  it.each(schemes)('are a Needs-you wash on the accent hue and a Failed wash on the danger hue (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    expect(p.needsYouWash).toEqual(scheme === 'light' ? { l: 0.935, c: 0.032, h: 270 } : { l: 0.29, c: 0.045, h: 270 })
    // Council round 3 A2: the dark Failed wash is darker and calmer so a red row stops glowing.
    expect(p.failedWash).toEqual(scheme === 'light' ? { l: 0.94, c: 0.031, h: 25 } : { l: 0.255, c: 0.032, h: 25 })
    // Needs you is the accent, so its wash follows a custom accent hue; Failed stays red.
    const moss = PaletteMath.palette({ ...WARM_STONE, accentHue: 150, scheme })
    expect(moss.needsYouWash.h).toBe(150)
    expect(moss.needsYouBandWash.h).toBe(150)
    expect(moss.failedWash.h).toBe(25)
  })

  it.each(schemes)('has a calmer Needs-you band for a full-width head band; rows keep the stronger wash (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    // Light sits at the gamut edge already (council round 5 A8), so the band is the row wash; dark drops from 0.045 to 0.035.
    expect(p.needsYouBandWash).toEqual(scheme === 'light' ? { l: 0.935, c: 0.032, h: 270 } : { l: 0.29, c: 0.035, h: 270 })
    expect(p.needsYouBandWash.c).toBeLessThanOrEqual(p.needsYouWash.c)
  })

  it.each(schemes)('keep ink, secondary text, the status glyphs and faint text readable on them (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    for (const [name, wash] of Object.entries({ needsYou: p.needsYouWash, needsYouBand: p.needsYouBandWash, failed: p.failedWash })) {
      for (const step of [9, 10]) expect(PaletteMath.contrastRatio(p.neutral[step]!, wash), `${name}: step ${step}`).toBeGreaterThanOrEqual(4.5)
      expect(PaletteMath.contrastRatio(p.neutral[8]!, wash), `${name}: faint`).toBeGreaterThanOrEqual(4.5)
      for (const key of ['accent', 'danger'] as const) expect(PaletteMath.contrastRatio(p[key].fg, wash), `${name}: ${key}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(schemes)('render the chroma they ask for: sRGB clipping costs at most 0.005 (council round 5 A8) (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    for (const [name, wash] of Object.entries({ needsYou: p.needsYouWash, needsYouBand: p.needsYouBandWash, failed: p.failedWash })) {
      const rendered = PaletteMath.hexToOklch(PaletteMath.toHex(wash))
      expect(Math.abs(rendered.c - wash.c), `${name}: asked ${wash.c}, rendered ${rendered.c.toFixed(4)}`).toBeLessThanOrEqual(0.005)
    }
  })

  it('reads at least as present as before in light: more rendered chroma than the clipped 0.029 and 0.025', () => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme: 'light' })
    expect(PaletteMath.hexToOklch(PaletteMath.toHex(p.needsYouWash)).c).toBeGreaterThan(0.031)
    expect(PaletteMath.hexToOklch(PaletteMath.toHex(p.failedWash)).c).toBeGreaterThan(0.03)
  })

  it('are emitted in both theme blocks and exposed as wash utilities', () => {
    const light = ThemeCss.blockDeclarations(WARM_STONE, 'light').join('\n')
    const dark = ThemeCss.blockDeclarations(WARM_STONE, 'dark').join('\n')
    expect(light).toContain('--dshx-wash-needs-you: oklch(0.935 0.032 270);')
    expect(light).toContain('--dshx-wash-failed: oklch(0.94 0.031 25);')
    expect(dark).toContain('--dshx-wash-needs-you: oklch(0.29 0.045 270);')
    expect(dark).toContain('--dshx-wash-failed: oklch(0.255 0.032 25);')
    expect(light).toContain('--dshx-wash-needs-you-band: oklch(0.935 0.032 270);')
    expect(dark).toContain('--dshx-wash-needs-you-band: oklch(0.29 0.035 270);')
    expect(roles).toContain('--color-wash-needs-you: var(--dshx-wash-needs-you);')
    expect(roles).toContain('--color-wash-needs-you-band: var(--dshx-wash-needs-you-band);')
    expect(roles).toContain('--color-wash-failed: var(--dshx-wash-failed);')
  })

  it('reaches the shared sheet as dshx:bg-wash-needs-you and dshx:bg-wash-failed', () => {
    const generated = readFileSync(join(process.cwd(), '../ui-styles/src/theme.generated.css'), 'utf8')
    expect(generated).toContain('--dshx-wash-needs-you:')
    expect(generated).toContain('--dshx-wash-failed:')
    expect(generated).toContain('--dshx-wash-needs-you-band:')
  })
})
