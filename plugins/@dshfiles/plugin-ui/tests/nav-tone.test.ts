import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PaletteMath, WARM_STONE, type Oklch, type Scheme } from '../src/theme/palette.ts'

// Vitest runs each package from its root.
const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
const schemes: readonly Scheme[] = ['light', 'dark']

/** The rail's destinations in order (thread-sidebar `DESTINATION_IDS`). */
const RAIL = ['threads', 'inbox', 'land', 'work', 'agents', 'observe', 'knowledge'] as const
/** Inbox is the attention destination: its glyph is neutral and its indigo AttentionBadge carries the colour (round 8). */
const NEUTRAL = ['inbox', 'settings'] as const
/** The destinations drawn in their own tone. */
const DESTINATIONS = RAIL.filter(destination => destination !== 'inbox')
/** Council round 8 A4: the six tones as far apart as the status bands allow. */
const HUES = { threads: 235, land: 180, work: 52, observe: 118, knowledge: 305, agents: 350 } as const
/** Status hues no nav tone may sit within 25° of: danger, warning, success, the accent. */
const STATUS_HUES = { red: 25, amber: 80, green: 150, indigo: 270 } as const

const body = (selector: string): string => {
  const start = roles.indexOf(`${selector} {`)
  return start < 0 ? '' : roles.slice(start, roles.indexOf('}', start))
}
const navTone = (scheme: Scheme, destination: string): Oklch => {
  const block = scheme === 'light' ? body('  body') : body('  body[data-ds-dark-theme]')
  const match = new RegExp(`--dshx-nav-tone-${destination}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\);`, 'u').exec(block)
  return { l: Number(match?.[1]), c: Number(match?.[2]), h: Number(match?.[3]) }
}
const lab = ({ l, c, h }: Oklch) => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)] as const
const deltaE = (a: Oklch, b: Oklch): number => {
  const [x, y] = [lab(a), lab(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}
const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}
/** Inside sRGB: the hex round trip keeps its chroma and lightness. */
const inGamut = (tone: Oklch): boolean => {
  const back = PaletteMath.hexToOklch(PaletteMath.toHex(tone))
  return Math.abs(back.c - tone.c) < 0.004 && Math.abs(back.l - tone.l) < 0.006
}
const gamutMaxChroma = (l: number, h: number): number => {
  let c = 0
  while (c < 0.4 && inGamut({ l, c: c + 0.002, h })) c += 0.002
  return c
}
/** `color-mix(in oklab, tone 14%, transparent)` painted over a surface: the browser composites the alpha in sRGB. */
const tile = (tone: Oklch, under: Oklch, alpha = 0.14): Oklch => {
  const channels = (color: Oklch) => [1, 3, 5].map(at => Number.parseInt(PaletteMath.toHex(color).slice(at, at + 2), 16))
  const [top, bottom] = [channels(tone), channels(under)]
  const mixed = bottom.map((value, index) => Math.round(value * (1 - alpha) + (top[index] ?? 0) * alpha))
  return PaletteMath.hexToOklch(`#${mixed.map(value => value.toString(16).padStart(2, '0')).join('')}`)
}

describe('navigation identity tones (council round 4 A1)', () => {
  it('gives every rail destination its own tone on body so dark follows, Inbox and Settings neutral', () => {
    for (const scheme of schemes) for (const destination of DESTINATIONS) expect(navTone(scheme, destination).h, `${scheme} ${destination}`).not.toBeNaN()
    for (const destination of NEUTRAL) {
      expect(body('  body')).toContain(`--dshx-nav-tone-${destination}: var(--dsw-alias-label-secondary);`)
      // The secondary ink flips with the scheme by itself; a dark override would pin a tone again.
      expect(body('  body[data-ds-dark-theme]')).not.toContain(`--dshx-nav-tone-${destination}:`)
    }
    expect(roles).not.toMatch(/--dshx-nav-tone-[\w-]+: var\(--dsw-alias-state-/u)
    // The same hue in both schemes, so a destination keeps its colour when the scheme flips.
    for (const destination of DESTINATIONS) expect(navTone('dark', destination).h).toBe(navTone('light', destination).h)
  })

  it.each(schemes)('keeps every tone in its lightness band, in gamut and never muddy (%s)', scheme => {
    for (const destination of DESTINATIONS) {
      const tone = navTone(scheme, destination)
      const [low, high] = scheme === 'light' ? [0.52, 0.56] : [0.76, 0.8]
      expect(tone.l, destination).toBeGreaterThanOrEqual(low)
      expect(tone.l, destination).toBeLessThanOrEqual(high)
      expect(inGamut(tone), `${destination} in sRGB`).toBe(true)
      // The chroma floor is 0.12; where sRGB ends below it (teal and cyan at light L 0.56 stop near 0.11) the tone sits
      // at the gamut edge, which is as vivid as that hue gets.
      expect(tone.c, `${destination} chroma`).toBeGreaterThanOrEqual(Math.min(0.12, gamutMaxChroma(tone.l, tone.h) - 0.008))
    }
  })

  it('spreads the six hues at least 40° apart, each 25° from the status hues (council round 8 A4)', () => {
    for (const destination of DESTINATIONS) expect(navTone('light', destination).h, destination).toBe(HUES[destination])
    for (const [i, a] of DESTINATIONS.entries())
      for (const b of DESTINATIONS.slice(i + 1)) expect(hueDistance(navTone('light', a).h, navTone('light', b).h), `${a} vs ${b}`).toBeGreaterThanOrEqual(40)
    for (const destination of DESTINATIONS)
      for (const [status, hue] of Object.entries(STATUS_HUES))
        expect(hueDistance(navTone('light', destination).h, hue), `${destination} vs ${status}`).toBeGreaterThanOrEqual(25)
  })

  it.each(schemes)('spreads the six tones apart and away from the accent and status colours (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const status = { accent: p.accent.fg, success: p.success.fg, warning: p.warning.fg, danger: p.danger.fg }
    const tones = DESTINATIONS.map(destination => navTone(scheme, destination))
    // The round-four ramp's closest pair (olive and brown) was ΔE 0.050; the re-pick keeps every pair at 0.06 or more.
    for (const [i, a] of tones.entries()) for (const b of tones.slice(i + 1)) expect(deltaE(a, b), `${a.h} vs ${b.h}`).toBeGreaterThanOrEqual(0.06)
    for (const [i, tone] of tones.entries())
      for (const [name, colour] of Object.entries(status)) expect(deltaE(tone, colour), `${DESTINATIONS[i]} vs ${name}`).toBeGreaterThanOrEqual(0.06)
  })

  it('exposes each tone as a colour and as utilities for a tinted glyph and a 14% active tile', () => {
    for (const destination of [...RAIL, 'settings']) {
      expect(roles).toContain(`--color-nav-${destination}: var(--dshx-nav-tone-${destination});`)
      expect(roles).toMatch(new RegExp(`@utility nav-tone-${destination} \\{\\s*--dshx-nav-tone: var\\(--dshx-nav-tone-${destination}\\);\\s*\\}`, 'u'))
    }
    expect(roles).toMatch(/@utility text-nav-tone \{\s*color: var\(--dshx-nav-tone, currentColor\);\s*\}/u)
    expect(roles).toMatch(/@utility bg-nav-tile \{\s*background-color: color-mix\(in oklab, var\(--dshx-nav-tone, currentColor\) 14%, transparent\);\s*\}/u)
  })

  it.each(schemes)('draws each glyph at 3:1 on the page, the rail panel and its own active tile (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    for (const destination of DESTINATIONS) {
      const tone = navTone(scheme, destination)
      for (const step of [0, 1, 2]) {
        const surface = p.neutral[step]!
        expect(PaletteMath.contrastRatio(tone, surface), `${destination} on step ${step}`).toBeGreaterThanOrEqual(3)
        expect(PaletteMath.contrastRatio(tone, tile(tone, surface)), `${destination} on its tile over step ${step}`).toBeGreaterThanOrEqual(3)
        // The ink label beside it stays AA on the tile.
        expect(PaletteMath.contrastRatio(p.neutral[10]!, tile(tone, surface)), `ink on ${destination} tile`).toBeGreaterThanOrEqual(4.5)
      }
    }
    // The neutral glyphs are the secondary ink (step 9).
    for (const step of [0, 1, 2]) {
      const surface = p.neutral[step]!
      expect(PaletteMath.contrastRatio(p.neutral[9]!, surface), `neutral on step ${step}`).toBeGreaterThanOrEqual(3)
      expect(PaletteMath.contrastRatio(p.neutral[9]!, tile(p.neutral[9]!, surface)), `neutral on its tile over step ${step}`).toBeGreaterThanOrEqual(3)
    }
  })
})
