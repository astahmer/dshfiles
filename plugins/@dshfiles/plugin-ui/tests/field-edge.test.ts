/**
 * The field's resting edge (council round 18 A1): as light as WCAG 1.4.11 allows. It holds 3:1 on every surface a
 * field sits on (page, panel, raised, the nav column, the dark dialog fill, and a quiet trigger's chip, which it bounds
 * on hover), and one step lighter would not, for the default and the other contrast settings. The selected-row edge
 * stays darker than it.
 */
import { describe, expect, it } from 'vitest'
import { PaletteMath, WARM_STONE, type Oklch, type PaletteInput, type Scheme } from '../src/theme/palette.ts'

const schemes: readonly Scheme[] = ['light', 'dark']

/** `over` at `alpha` on an opaque `under`, composited in gamma sRGB as a browser paints it. */
const composite = (under: Oklch, over: Oklch, alpha: number): Oklch => {
  const channels = (color: Oklch): readonly number[] => [1, 3, 5].map(at => Number.parseInt(PaletteMath.toHex(color).slice(at, at + 2), 16))
  const [u, o] = [channels(under), channels(over)]
  return PaletteMath.hexToOklch(`#${u.map((value, i) => Math.round(value * (1 - alpha) + (o[i] ?? 0) * alpha).toString(16).padStart(2, '0')).join('')}`)
}

const surfacesOf = (input: PaletteInput) => {
  const p = PaletteMath.palette(input)
  const dark = input.scheme === 'dark'
  const chip = (under: Oklch): Oklch => composite(under, p.triggerFill, p.triggerFill.alpha ?? 1)
  return {
    bg: p.neutral[0]!,
    panel: p.neutral[1]!,
    raised: p.neutral[2]!,
    nav: p.navSurface,
    dialog: dark ? { l: 0.27, c: 0.006, h: 60 } : p.neutral[0]!,
    'chip on bg': chip(p.neutral[0]!),
    'chip on panel': chip(p.neutral[1]!),
    'chip on nav': chip(p.navSurface),
  }
}

const weakest = (edge: Oklch, surfaces: ReturnType<typeof surfacesOf>): number => Math.min(...Object.values(surfaces).map(surface => PaletteMath.contrastRatio(edge, surface)))

describe('field resting edge (council round 18 A1)', () => {
  it.each(schemes)('is the lightest edge that still holds 3:1 on every surface (%s)', scheme => {
    for (const input of [WARM_STONE, { ...WARM_STONE, contrast: 0.8 }, { hue: 250, chroma: 0, accentHue: 150, contrast: 1 }]) {
      const full = { ...input, scheme }
      const { fieldBorder } = PaletteMath.palette(full)
      const surfaces = surfacesOf(full)
      expect(weakest(fieldBorder, surfaces), JSON.stringify(input)).toBeGreaterThanOrEqual(3)
      // One step lighter (toward the surface) would drop under 3:1 somewhere: the edge has no slack left.
      const lighter = { ...fieldBorder, l: fieldBorder.l + (scheme === 'light' ? 0.005 : -0.005) }
      expect(weakest(lighter, surfaces), JSON.stringify(input)).toBeLessThan(3)
    }
  })

  it.each(schemes)('stays lighter than the selected-row edge (%s)', scheme => {
    const { fieldBorder, selectedEdge } = PaletteMath.palette({ ...WARM_STONE, scheme })
    expect(scheme === 'light' ? fieldBorder.l - selectedEdge.l : selectedEdge.l - fieldBorder.l).toBeGreaterThanOrEqual(0.08)
  })

  it('emits the default values the design doc names', () => {
    expect(PaletteMath.toHex(PaletteMath.palette({ ...WARM_STONE, scheme: 'light' }).fieldBorder)).toBe('#89847f')
    expect(PaletteMath.toHex(PaletteMath.palette({ ...WARM_STONE, scheme: 'dark' }).fieldBorder)).toBe('#746f6a')
  })
})
