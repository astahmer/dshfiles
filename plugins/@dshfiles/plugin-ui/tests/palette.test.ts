import { describe, expect, it } from 'vitest'
import { contrastRatio, hexToOklch, neutralChroma, palette, standaloneColours, toCss, toHex, WARM_STONE, type Scheme } from '../src/theme/palette.ts'

const schemes: readonly Scheme[] = ['light', 'dark']
const surfaces = { bg: 0, panel: 1, raised: 2 } as const

describe('palette', () => {
  it.each(schemes)('keeps every text step at WCAG AA on bg, panel and raised (%s)', scheme => {
    const p = palette({ ...WARM_STONE, scheme })
    for (const [surface, step] of Object.entries(surfaces)) {
      const under = p.neutral[step]!
      // Steps 9 (secondary) and 10 (primary) are body text: AA 4.5:1.
      for (const text of [9, 10]) expect(contrastRatio(p.neutral[text]!, under), `step ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      // Step 8 (tertiary, placeholder) is non-essential text: at least the 3:1 large-text/UI floor.
      expect(contrastRatio(p.neutral[8]!, under), `step 8 on ${surface}`).toBeGreaterThanOrEqual(3)
      // Accent and status colours are read as text (links, "Needs you", error lines): AA too.
      for (const key of ['success', 'warning', 'danger', 'info'] as const) {
        expect(contrastRatio(p[key].fg, under), `${key} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrastRatio(p.accent.fg, under), `accent on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrastRatio(p.accent.onSolid, p.accent.fg), 'text on a solid accent').toBeGreaterThanOrEqual(4.5)
  })

  it('makes warm light mode at most half as chromatic as dark (D1)', () => {
    const light = palette({ ...WARM_STONE, scheme: 'light' })
    const dark = palette({ ...WARM_STONE, scheme: 'dark' })
    light.neutral.forEach((color, step) => expect(color.c).toBeLessThanOrEqual(dark.neutral[step]!.c / 2 + 1e-9))
    expect(neutralChroma(0.007, 'dark')).toEqual({ fill: 0.007, text: 0.005 })
    for (const color of dark.neutral) expect(color.h).toBe(65)
  })

  it('emits 11 monotonic steps from background to text', () => {
    for (const scheme of schemes) {
      const { neutral } = palette({ ...WARM_STONE, scheme })
      expect(neutral).toHaveLength(11)
      const ls = neutral.map(c => c.l)
      const sorted = [...ls].sort((a, b) => (scheme === 'dark' ? a - b : b - a))
      expect(ls).toEqual(sorted)
    }
  })

  it('matches the token spec table for the anchor steps', () => {
    expect(toHex(palette({ ...WARM_STONE, scheme: 'dark' }).neutral[0]!)).toBe('#110e0b')
    expect(toHex(palette({ ...WARM_STONE, scheme: 'dark' }).neutral[10]!)).toBe('#f3efed')
    expect(palette({ ...WARM_STONE, scheme: 'light' }).neutral[0]!.l).toBe(0.992)
  })

  it('spreads borders and text further at a higher contrast without moving the fills', () => {
    const standard = palette({ ...WARM_STONE, scheme: 'dark' })
    const high = palette({ ...WARM_STONE, contrast: 1.2, scheme: 'dark' })
    expect(high.neutral[1]).toEqual(standard.neutral[1])
    expect(high.neutral[4]!.l).toBeGreaterThan(standard.neutral[4]!.l)
    expect(high.neutral[10]!.l).toBeLessThanOrEqual(1)
  })

  it('gives each status a 12% fill and a 30% border of its own colour', () => {
    const { danger } = palette({ ...WARM_STONE, scheme: 'light' })
    expect(danger.bg).toEqual({ ...danger.fg, alpha: 0.12 })
    expect(toCss(danger.border)).toBe('oklch(0.5 0.15 25 / 0.3)')
  })

  it('round-trips hex through oklch', () => {
    expect(toHex(hexToOklch('#4176e6'))).toBe('#4176e6')
    expect(hexToOklch('#fff').l).toBeCloseTo(1, 3)
  })
})

describe('standaloneColours', () => {
  it('returns hex for every role in both schemes, text holding AA on the background', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const colours = standaloneColours(scheme)
      for (const value of Object.values(colours)) expect(value).toMatch(/^#[0-9a-f]{6}$/u)
      expect(contrastRatio(hexToOklch(colours.text), hexToOklch(colours.bg))).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(hexToOklch(colours.muted), hexToOklch(colours.bg))).toBeGreaterThanOrEqual(4.5)
    }
  })
})
