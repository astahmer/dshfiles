import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PaletteMath, WARM_STONE, type Oklch, type Scheme } from '../src/theme/palette.ts'

const schemes: readonly Scheme[] = ['light', 'dark']
const surfaces = { bg: 0, panel: 1, raised: 2 } as const

describe('palette', () => {
  it.each(schemes)('keeps every text step at WCAG AA on bg, panel and raised (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    for (const [surface, step] of Object.entries(surfaces)) {
      const under = p.neutral[step]!
      // Steps 9 (secondary) and 10 (primary) are body text: AA 4.5:1.
      for (const text of [9, 10]) expect(PaletteMath.contrastRatio(p.neutral[text]!, under), `step ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      // Step 8 (tertiary, placeholder) is non-essential text: at least the 3:1 large-text/UI floor.
      expect(PaletteMath.contrastRatio(p.neutral[8]!, under), `step 8 on ${surface}`).toBeGreaterThanOrEqual(3)
      // Accent and status colours are read as text (links, "Needs you", error lines): AA too.
      for (const key of ['success', 'warning', 'danger', 'info'] as const) {
        expect(PaletteMath.contrastRatio(p[key].fg, under), `${key} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(PaletteMath.contrastRatio(p.accent.fg, under), `accent on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(PaletteMath.contrastRatio(p.accent.onSolid, p.accent.fg), 'text on a solid accent').toBeGreaterThanOrEqual(4.5)
  })

  it('makes warm light mode at most half as chromatic as dark (D1)', () => {
    const light = PaletteMath.palette({ ...WARM_STONE, scheme: 'light' })
    const dark = PaletteMath.palette({ ...WARM_STONE, scheme: 'dark' })
    light.neutral.forEach((color, step) => expect(color.c).toBeLessThanOrEqual(dark.neutral[step]!.c / 2 + 1e-9))
    expect(PaletteMath.neutralChroma(0.007, 'dark')).toEqual({ fill: 0.007, text: 0.005 })
    for (const color of dark.neutral) expect(color.h).toBe(65)
  })

  it('emits 11 monotonic steps from background to text', () => {
    for (const scheme of schemes) {
      const { neutral } = PaletteMath.palette({ ...WARM_STONE, scheme })
      expect(neutral).toHaveLength(11)
      const ls = neutral.map(c => c.l)
      const sorted = [...ls].sort((a, b) => (scheme === 'dark' ? a - b : b - a))
      expect(ls).toEqual(sorted)
    }
  })

  it('matches the token spec table for the anchor steps', () => {
    expect(PaletteMath.toHex(PaletteMath.palette({ ...WARM_STONE, scheme: 'dark' }).neutral[0]!)).toBe('#15120f')
    expect(PaletteMath.toHex(PaletteMath.palette({ ...WARM_STONE, scheme: 'dark' }).neutral[10]!)).toBe('#eae7e4')
    expect(PaletteMath.palette({ ...WARM_STONE, scheme: 'light' }).neutral[0]!.l).toBe(0.992)
  })

  it('spreads the surface steps wider, mostly in dark (round five K1)', () => {
    const ls = (scheme: Scheme) => PaletteMath.palette({ ...WARM_STONE, scheme }).neutral.map(color => color.l)
    expect(ls('dark').slice(0, 6)).toEqual([0.185, 0.21, 0.245, 0.27, 0.295, 0.335])
    expect(ls('dark')[10]).toBe(0.93)
    expect(ls('light').slice(0, 3)).toEqual([0.992, 0.962, 0.935])
    for (const color of PaletteMath.palette({ ...WARM_STONE, scheme: 'dark' }).neutral.slice(0, 7)) expect(color).toMatchObject({ c: 0.007, h: 65 })
  })

  it.each(schemes)('keeps faint text at AA on bg, panel, raised and every row wash (%s, round five A3)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const faint = p.neutral[8]!
    const under = { bg: p.neutral[0]!, panel: p.neutral[1]!, raised: p.neutral[2]!, selected: p.selectedWash, needsYou: p.needsYouWash, needsYouBand: p.needsYouBandWash, failed: p.failedWash }
    for (const [surface, color] of Object.entries(under)) expect(PaletteMath.contrastRatio(faint, color), `faint on ${surface}`).toBeGreaterThanOrEqual(4.5)
    expect(faint.l).toBe(scheme === 'light' ? 0.52 : 0.66)
    // Still a step below secondary text.
    expect(PaletteMath.contrastRatio(faint, p.neutral[0]!)).toBeLessThan(PaletteMath.contrastRatio(p.neutral[9]!, p.neutral[0]!))
  })

  it('spreads borders and text further at a higher contrast without moving the fills', () => {
    const standard = PaletteMath.palette({ ...WARM_STONE, scheme: 'dark' })
    const high = PaletteMath.palette({ ...WARM_STONE, contrast: 1.2, scheme: 'dark' })
    expect(high.neutral[1]).toEqual(standard.neutral[1])
    expect(high.neutral[4]!.l).toBeGreaterThan(standard.neutral[4]!.l)
    expect(high.neutral[10]!.l).toBeLessThanOrEqual(1)
  })

  it('gives each status a 12% fill and a 30% border of its own colour', () => {
    const { danger } = PaletteMath.palette({ ...WARM_STONE, scheme: 'light' })
    expect(danger.bg).toEqual({ ...danger.fg, alpha: 0.12 })
    expect(PaletteMath.toCss(danger.border)).toBe('oklch(0.5 0.15 25 / 0.3)')
  })

  it('round-trips hex through oklch', () => {
    expect(PaletteMath.toHex(PaletteMath.hexToOklch('#4176e6'))).toBe('#4176e6')
    expect(PaletteMath.hexToOklch('#fff').l).toBeCloseTo(1, 3)
  })
})

describe('colour roles (DESIGN.md › Colour roles)', () => {
  // Vitest runs each package from its root; jsdom gives import.meta.url a non-file scheme here.
  const css = (() => {
    try {
      return readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
    } catch {
      return ''
    }
  })()
  const block = (selector: string): string => css.match(new RegExp(`${selector.replace(/[[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
  const identity = (body: string): readonly Oklch[] =>
    [...body.matchAll(/--dshx-identity-(\d):\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g)].map(([, , l, c, h]) => ({ l: Number(l), c: Number(c), h: Number(h) }))
  const ramps = { light: identity(block(':root')), dark: identity(block('body[data-ds-dark-theme]')) } as const

  it.each(schemes)('defines identity-1..8 that hold AA text on bg, panel and raised (%s)', scheme => {
    const ramp = ramps[scheme]
    expect(ramp).toHaveLength(8)
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    ramp.forEach((tone, index) => {
      for (const [surface, step] of Object.entries(surfaces))
        expect(PaletteMath.contrastRatio(tone, p.neutral[step]!), `identity-${index + 1} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    })
  })

  it('matches the round-two token table', () => {
    expect(ramps.light.map(PaletteMath.toHex)).toEqual(['#007373', '#7444b4', '#9b4805', '#a42c71', '#27762f', '#71640b', '#006c9d', '#805b2c'])
    expect(ramps.dark.map(PaletteMath.toHex)).toEqual(['#6bcac9', '#c4a4fe', '#fa9d68', '#f594c3', '#80cd82', '#c6b96b', '#61c3f9', '#d9af7f'])
  })

  it('exposes every role as a Tailwind colour, on the existing semantic values', () => {
    const theme = block('@theme inline')
    const roles = {
      'status-needs-you': 'var(--dsw-alias-state-business-primary)',
      'control-on': 'var(--dshx-control-on, var(--dsw-alias-label-primary))',
      'control-on-foreground': 'var(--dshx-control-on-foreground, var(--dsw-alias-label-primary-foreground))',
      'status-failed': 'var(--dsw-alias-state-error-primary)',
      'health-down': 'var(--dsw-alias-state-error-primary)',
      'status-ready': 'var(--dsw-alias-state-success-primary)',
      'health-ok': 'var(--dsw-alias-state-success-primary)',
      'health-limited': 'var(--dsw-alias-state-warn-primary)',
      'status-working': 'var(--dsw-alias-label-primary)',
      'status-idle': 'var(--dsw-alias-label-tertiary)',
      'health-off': 'var(--dsw-alias-label-tertiary)',
      'status-done': 'var(--dsw-alias-label-secondary)',
      'data-1': 'var(--dshx-data-1)',
      'data-2': 'var(--dshx-data-2)',
      'data-3': 'var(--dshx-data-3)',
      'data-4': 'var(--dshx-data-4)',
      'data-5': 'var(--dshx-data-5)',
      'data-6': 'var(--dshx-data-6)',
    }
    for (const [role, value] of Object.entries(roles)) expect(theme, role).toContain(`--color-${role}: ${value};`)
    for (let n = 1; n <= 8; n += 1) expect(theme).toContain(`--color-identity-${n}: var(--dshx-identity-${n});`)
    expect(block(':root')).toContain('--dshx-duration-hold: 1200ms;')
  })

  const data = (body: string): readonly Oklch[] =>
    [...body.matchAll(/--dshx-data-(\d):\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g)].map(([, , l, c, h]) => ({ l: Number(l), c: Number(c), h: Number(h) }))
  const dataRamps = { light: data(block(':root')), dark: data(block('body[data-ds-dark-theme]')) } as const

  it.each(schemes)('starts the data ramp with identity tones, never the accent or a status hue (%s, round five K5)', scheme => {
    const ramp = dataRamps[scheme]
    expect(ramp.map(tone => tone.h)).toEqual([195, 305, 55, 340, 110, 225])
    for (const tone of ramp) expect(tone).toMatchObject(scheme === 'light' ? { l: 0.6, c: 0.12 } : { l: 0.7, c: 0.11 })
    // A chart mark is a graphic: 3:1 where charts sit (the page and panels; raised too in dark).
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const under = scheme === 'light' ? { bg: 0, panel: 1 } : surfaces
    ramp.forEach((tone, index) => {
      for (const [surface, step] of Object.entries(under))
        expect(PaletteMath.contrastRatio(tone, p.neutral[step]!), `data-${index + 1} on ${surface}`).toBeGreaterThanOrEqual(3)
    })
  })

  it('is imported by the kit stylesheet with one line', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
    expect(styles.match(/@import '\.\/color-roles\.css';/g)).toHaveLength(1)
  })
})

describe('standaloneColours', () => {
  it('returns hex for every role in both schemes, text holding AA on the background', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const colours = PaletteMath.standaloneColours(scheme)
      for (const value of Object.values(colours)) expect(value).toMatch(/^#[0-9a-f]{6}$/u)
      expect(PaletteMath.contrastRatio(PaletteMath.hexToOklch(colours.text), PaletteMath.hexToOklch(colours.bg))).toBeGreaterThanOrEqual(4.5)
      expect(PaletteMath.contrastRatio(PaletteMath.hexToOklch(colours.muted), PaletteMath.hexToOklch(colours.bg))).toBeGreaterThanOrEqual(4.5)
    }
  })
})
