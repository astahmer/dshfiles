// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectMark, projectMarkLetters, projectToneIndex } from '../src/components/ui/project-mark.js'
import { PaletteMath, WARM_STONE, type Oklch, type Scheme } from '../src/theme/palette.ts'

afterEach(cleanup)

const schemes: readonly Scheme[] = ['light', 'dark']
const surfaces = { bg: 0, panel: 1, raised: 2 } as const
/** A mark also sits on a selected row. */
const markSurfaces = { ...surfaces, selected: 3 } as const
/** Status hues (danger, warning, success, accent) a project tone keeps 25° away from (round five K4). */
const STATUS_HUES = [25, 80, 150, 270] as const

// Vitest runs each package from its root; jsdom gives import.meta.url a non-file scheme here.
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
const block = (selector: string): string => styles.match(new RegExp(`${selector.replace(/[[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
const tones = (body: string, palette: 'balanced' | 'cool'): readonly Oklch[] =>
  [...body.matchAll(new RegExp(`--dshx-project-${palette}-(\\d):\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`, 'g'))].map(([, , l, c, h]) => ({
    l: Number(l),
    c: Number(c),
    h: Number(h),
  }))
const ramps = {
  light: { balanced: tones(block(':root'), 'balanced'), cool: tones(block(':root'), 'cool') },
  dark: { balanced: tones(block('body[data-ds-dark-theme]'), 'balanced'), cool: tones(block('body[data-ds-dark-theme]'), 'cool') },
} as const

const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** `over` at `alpha` on an opaque `under`, composited in gamma sRGB as a browser paints it. */
const composite = (under: Oklch, over: Oklch, alpha: number): Oklch => {
  const channels = (color: Oklch): readonly number[] =>
    PaletteMath.toHex(color)
      .slice(1)
      .match(/../g)!
      .map(pair => Number.parseInt(pair, 16))
  const [u, o] = [channels(under), channels(over)]
  const hex = u.map((value, i) => Math.round(value * (1 - alpha) + o[i]! * alpha).toString(16).padStart(2, '0')).join('')
  return PaletteMath.hexToOklch(`#${hex}`)
}

/** CSS `color-mix(in oklab, a, b t)`. */
const mixOklab = (a: Oklch, b: Oklch, t: number): Oklch => {
  const lab = ({ l, c, h }: Oklch) => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)] as const
  const [p, q] = [lab(a), lab(b)]
  const lerp = (from: number, to: number): number => from + (to - from) * t
  const [l, x, y] = [lerp(p[0], q[0]), lerp(p[1], q[1]), lerp(p[2], q[2])]
  const h = (Math.atan2(y, x) * 180) / Math.PI
  return { l, c: Math.hypot(x, y), h: h < 0 ? h + 360 : h }
}

const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
/** The share of ink `.dshx-project-mark-letters` mixes into the tone. */
const letterInk = 1 - Number(roles.match(/\.dshx-project-mark-letters\s*\{\s*color: color-mix\(in oklab, currentColor (\d+)%, var\(--dsw-alias-label-primary\)\)/)?.[1] ?? 100) / 100

describe('project tones (round five K4)', () => {
  it.each(schemes)('uses the six status-safe identity hues in oklch (%s)', scheme => {
    for (const palette of ['balanced', 'cool'] as const) {
      const ramp = ramps[scheme][palette]
      expect(ramp, palette).toHaveLength(6)
      expect([...ramp.map(tone => tone.h)].sort((a, b) => a - b), palette).toEqual([55, 110, 195, 225, 305, 340])
      for (const tone of ramp) {
        for (const status of STATUS_HUES) expect(hueDistance(tone.h, status), `${palette} hue ${tone.h} vs status ${status}`).toBeGreaterThanOrEqual(25)
        expect(tone, `${palette} ${tone.h}`).toMatchObject(scheme === 'light' ? { l: 0.5, c: 0.11 } : { l: 0.78, c: 0.1 })
      }
    }
  })

  it.each(schemes)('holds AA as text on bg, panel and raised (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    for (const tone of ramps[scheme].balanced) {
      for (const [surface, step] of Object.entries(surfaces))
        expect(PaletteMath.contrastRatio(tone, p.neutral[step]!), `hue ${tone.h} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(schemes)('holds AA for the mark letters on their own tile over bg, panel, raised and selected (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    expect(letterInk, 'ink share of the letters').toBeGreaterThan(0)
    for (const tone of ramps[scheme].balanced) {
      const letters = mixOklab(tone, p.neutral[10]!, letterInk)
      for (const [surface, step] of Object.entries(markSurfaces)) {
        const tile = composite(p.neutral[step]!, tone, 0.14)
        expect(PaletteMath.contrastRatio(letters, tile), `hue ${tone.h} letters on its tile over ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps the project-tone classes that set the colour', () => {
    for (let n = 0; n < 6; n += 1) {
      expect(block(`.project-tone-balanced-${n}`)).toContain(`color: var(--dshx-project-balanced-${n});`)
      expect(block(`.project-tone-cool-${n}`)).toContain(`color: var(--dshx-project-cool-${n});`)
    }
  })
})

describe('ProjectMark', () => {
  it('takes the first letters of the first two words, else the first two letters', () => {
    expect(projectMarkLetters('billing-api')).toBe('BA')
    expect(projectMarkLetters('web app')).toBe('WA')
    expect(projectMarkLetters('docs_site')).toBe('DS')
    expect(projectMarkLetters('dshfiles')).toBe('DS')
    expect(projectMarkLetters('  .x  ')).toBe('X')
    expect(projectMarkLetters('élan vital')).toBe('ÉV')
    expect(projectMarkLetters('')).toBe('?')
  })

  it('draws a 20px tile with the identity colour at 14% behind its letters', () => {
    const view = render(<ProjectMark name="billing-api" tone={3} />)
    const mark = view.container.querySelector<HTMLElement>('[data-slot="project-mark"]')!
    expect(mark.textContent).toBe('BA')
    expect(mark.querySelector('.dshx-project-mark-letters')?.textContent).toBe('BA')
    expect(mark.getAttribute('aria-hidden')).toBe('true')
    const classes = mark.className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['dshx:h-5', 'dshx:min-w-5', 'dshx:rounded-sm', 'dshx:bg-current/14', 'project-tone-balanced-3']))
    expect(mark.getAttribute('data-size')).toBe('default')
  })

  it('is 16px when dense, grows instead of clipping, and paints a custom colour', () => {
    const view = render(<ProjectMark name="wow wow" color="#336699" size="dense" />)
    const mark = view.container.querySelector<HTMLElement>('[data-slot="project-mark"]')!
    const classes = mark.className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['dshx:h-4', 'dshx:min-w-4', 'dshx:w-auto']))
    expect(classes.join(' ')).not.toMatch(/overflow-hidden|truncate/)
    expect(mark.style.color).toBe('rgb(51, 102, 153)')
    expect(mark.className).not.toMatch(/project-tone-/)
  })

  it('hashes the name to a stable tone when none is chosen, in the palette asked for', () => {
    expect(projectToneIndex('web-app')).toBe(projectToneIndex('web-app'))
    const view = render(<ProjectMark name="web-app" palette="cool" />)
    expect(view.container.querySelector('[data-slot="project-mark"]')!.className).toContain(`project-tone-cool-${projectToneIndex('web-app')}`)
  })

  it('is an image named after the project when it stands alone', () => {
    const view = render(<ProjectMark name="billing-api" decorative={false} />)
    expect(view.getByRole('img', { name: 'billing-api' }).textContent).toBe('BA')
  })
})
