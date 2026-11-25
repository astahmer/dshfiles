import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PaletteMath, WARM_STONE, type Oklch, type Scheme } from '../src/theme/palette.ts'

// Vitest runs each package from its root.
const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
const schemes: readonly Scheme[] = ['light', 'dark']

/** The rail's destinations in order (thread-sidebar `DESTINATION_IDS`) and the identity tone each draws in. */
const NAV_TONES = { threads: 7, inbox: 2, land: 1, work: 3, agents: 4, observe: 6, knowledge: 8 } as const

const body = (selector: string): string => {
  const start = roles.indexOf(`${selector} {`)
  return start < 0 ? '' : roles.slice(start, roles.indexOf('}', start))
}
const identity = (scheme: Scheme, n: number): Oklch => {
  const block = scheme === 'light' ? body('  :root') : body('  body[data-ds-dark-theme]')
  const match = new RegExp(`--dshx-identity-${n}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`, 'u').exec(block)
  return { l: Number(match?.[1]), c: Number(match?.[2]), h: Number(match?.[3]) }
}
const lab = ({ l, c, h }: Oklch) => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)] as const
const deltaE = (a: Oklch, b: Oklch): number => {
  const [x, y] = [lab(a), lab(b)]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}
/** `color-mix(in oklab, tone 14%, transparent)` painted over a surface: the browser composites the alpha in sRGB. */
const tile = (tone: Oklch, under: Oklch, alpha = 0.14): Oklch => {
  const channels = (color: Oklch) => [1, 3, 5].map(at => Number.parseInt(PaletteMath.toHex(color).slice(at, at + 2), 16))
  const [top, bottom] = [channels(tone), channels(under)]
  const mixed = bottom.map((value, index) => Math.round(value * (1 - alpha) + (top[index] ?? 0) * alpha))
  return PaletteMath.hexToOklch(`#${mixed.map(value => value.toString(16).padStart(2, '0')).join('')}`)
}

describe('navigation identity tones (council round 3 A7)', () => {
  it('maps every rail destination onto an identity tone, Settings neutral, on body so dark follows', () => {
    const tones = body('  body')
    for (const [destination, n] of Object.entries(NAV_TONES)) expect(tones, destination).toContain(`--dshx-nav-tone-${destination}: var(--dshx-identity-${n});`)
    expect(tones).toContain('--dshx-nav-tone-settings: var(--dsw-alias-label-secondary);')
    expect(new Set(Object.values(NAV_TONES)).size).toBe(Object.keys(NAV_TONES).length)
  })

  it('never borrows the green identity tone, the accent or a status colour', () => {
    expect(Object.values(NAV_TONES)).not.toContain(5)
    expect(roles).not.toMatch(/--dshx-nav-tone-[\w-]+: var\(--dsw-alias-state-/u)
  })

  it.each(schemes)('keeps every nav tone apart from the accent and the status colours (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const status = { accent: p.accent.fg, success: p.success.fg, warning: p.warning.fg, danger: p.danger.fg }
    for (const [destination, n] of Object.entries(NAV_TONES))
      for (const [name, colour] of Object.entries(status)) expect(deltaE(identity(scheme, n), colour), `${destination} vs ${name}`).toBeGreaterThanOrEqual(0.045)
  })

  it('exposes each tone as a colour and as utilities for a tinted glyph and a 14% active tile', () => {
    for (const destination of [...Object.keys(NAV_TONES), 'settings']) {
      expect(roles).toContain(`--color-nav-${destination}: var(--dshx-nav-tone-${destination});`)
      expect(roles).toMatch(new RegExp(`@utility nav-tone-${destination} \\{\\s*--dshx-nav-tone: var\\(--dshx-nav-tone-${destination}\\);\\s*\\}`, 'u'))
    }
    expect(roles).toMatch(/@utility text-nav-tone \{\s*color: var\(--dshx-nav-tone, currentColor\);\s*\}/u)
    expect(roles).toMatch(/@utility bg-nav-tile \{\s*background-color: color-mix\(in oklab, var\(--dshx-nav-tone, currentColor\) 14%, transparent\);\s*\}/u)
  })

  it.each(schemes)('draws each glyph at 3:1 on the page, the rail panel and its own active tile (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    for (const [destination, n] of Object.entries(NAV_TONES)) {
      const tone = identity(scheme, n)
      for (const step of [0, 1, 2]) {
        const surface = p.neutral[step]!
        expect(PaletteMath.contrastRatio(tone, surface), `${destination} on step ${step}`).toBeGreaterThanOrEqual(3)
        expect(PaletteMath.contrastRatio(tone, tile(tone, surface)), `${destination} on its tile over step ${step}`).toBeGreaterThanOrEqual(3)
        // The ink label beside it stays AA on the tile.
        expect(PaletteMath.contrastRatio(p.neutral[10]!, tile(tone, surface)), `ink on ${destination} tile`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
