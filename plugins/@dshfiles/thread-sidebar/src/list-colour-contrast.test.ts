// @vitest-environment node
import { PaletteMath, WARM_STONE, type Oklch, type Scheme } from '@dshfiles/plugin-ui/theme/palette'
import { describe, expect, it } from 'vitest'

/**
 * The colour round five put in the thread list (T2) keeps every pair readable: the Needs-you row's 6% indigo wash and the
 * Failed row's 5% red wash under ink, secondary text, the status glyph and the row's attention verb; the Needs you group's
 * count chips on their 12% tints. Over the page and the panel step, in both schemes.
 */
const schemes: readonly Scheme[] = ['light', 'dark']
const surfaces = { bg: 0, panel: 1 } as const

/** `over` at `alpha` on an opaque `under`, composited in gamma sRGB as a browser paints it. */
const composite = (under: Oklch, over: Oklch, alpha: number): Oklch => {
  const channels = (color: Oklch): readonly number[] =>
    (PaletteMath.toHex(color).slice(1).match(/../g) ?? []).map(pair => Number.parseInt(pair, 16))
  const [u, o] = [channels(under), channels(over)]
  return PaletteMath.hexToOklch(`#${u.map((value, i) => Math.round(value * (1 - alpha) + (o[i] ?? 0) * alpha).toString(16).padStart(2, '0')).join('')}`)
}

/** CSS `color-mix(in oklab, a, b t)`: the kit's attention and danger-tint foregrounds pull the status hue 30% toward ink. */
const mixOklab = (a: Oklch, b: Oklch, t: number): Oklch => {
  const lab = ({ l, c, h }: Oklch) => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)] as const
  const [p, q] = [lab(a), lab(b)]
  const lerp = (from: number, to: number): number => from + (to - from) * t
  const [l, x, y] = [lerp(p[0], q[0]), lerp(p[1], q[1]), lerp(p[2], q[2])]
  const h = (Math.atan2(y, x) * 180) / Math.PI
  return { l, c: Math.hypot(x, y), h: h < 0 ? h + 360 : h }
}

describe.each(schemes)('thread list colour (%s)', scheme => {
  const p = PaletteMath.palette({ ...WARM_STONE, scheme })
  const ink = p.neutral[10]!
  const secondary = p.neutral[9]!
  const washes = [
    { name: 'needs-you', hue: p.accent.fg, alpha: 0.06 },
    { name: 'failed', hue: p.danger.fg, alpha: 0.05 },
  ] as const

  it.each(washes)('keeps ink and secondary text at AA and the glyph at 3:1 on the $name wash', wash => {
    for (const [surface, step] of Object.entries(surfaces)) {
      const row = composite(p.neutral[step]!, wash.hue, wash.alpha)
      expect(PaletteMath.contrastRatio(ink, row), `ink over ${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(PaletteMath.contrastRatio(secondary, row), `secondary over ${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(PaletteMath.contrastRatio(wash.hue, row), `glyph over ${surface}`).toBeGreaterThanOrEqual(3)
    }
  })

  it.each(washes)('keeps the row verb at AA on its tint over the $name wash, at rest and on hover', wash => {
    const text = mixOklab(wash.hue, ink, 0.3)
    for (const [surface, step] of Object.entries(surfaces)) {
      const row = composite(p.neutral[step]!, wash.hue, wash.alpha)
      for (const alpha of [0.12, 0.18]) expect(PaletteMath.contrastRatio(text, composite(row, wash.hue, alpha)), `${alpha} over ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the count chips at AA on their 12% tints', () => {
    for (const hue of [p.accent.fg, p.danger.fg])
      for (const step of Object.values(surfaces))
        expect(PaletteMath.contrastRatio(mixOklab(hue, ink, 0.3), composite(p.neutral[step]!, hue, 0.12))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the active rail and page icon at 3:1 on the selected wash', () => {
    expect(PaletteMath.contrastRatio(p.accent.fg, p.selectedWash)).toBeGreaterThanOrEqual(3)
  })

  it('keeps a Settings group head (12px, tertiary ink) at AA on the nav column (council round 13 B5)', () => {
    expect(PaletteMath.contrastRatio(p.neutral[8]!, p.neutral[1]!)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps every current phone tab glyph at 3:1 on the one neutral pill (council round 13 B2)', () => {
    // PHONE_TAB_PILL: the secondary ink at 14% over the tab bar's nav fill (tone-1). The tab tones from color-roles.css.
    const pill = composite(p.neutral[1]!, secondary, 0.14)
    const tones = scheme === 'light' ? { threads: { l: 0.56, c: 0.124, h: 235 }, land: { l: 0.56, c: 0.102, h: 180 } } : { threads: { l: 0.78, c: 0.13, h: 235 }, land: { l: 0.78, c: 0.13, h: 180 } }
    for (const [tab, tone] of Object.entries({ ...tones, ink: ink })) expect(PaletteMath.contrastRatio(tone, pill), tab).toBeGreaterThanOrEqual(3)
    // The 600 label sits under the pill on the bar itself.
    expect(PaletteMath.contrastRatio(ink, p.neutral[1]!)).toBeGreaterThanOrEqual(4.5)
  })
})
