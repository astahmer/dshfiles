// @vitest-environment jsdom
/**
 * The selected-place tile (council round 9 A1): a selected nav row, side-column row, tab or phone tab-bar tab puts its
 * glyph on a 14% tile of its tone. Checked in the compiled sheet (the selectors that light the tile), in the component
 * and in colour (glyph 3:1, ink label AA on the tile over every surface it sits on, for nav and identity tones).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PLACE_TONE_CLASS, PlaceGlyph, placeToneStyle } from '../src/components/ui/place-glyph.js'
import { PaletteMath, WARM_STONE, type Oklch, type Scheme } from '../src/theme/palette.ts'

afterEach(cleanup)

type Compiler = { build(candidates: readonly string[]): string }
type CompileOptions = { readonly base: string; readonly onDependency: (path: string) => void }
let sheet = ''

beforeAll(async () => {
  const vite = createRequire(join(process.cwd(), 'package.json')).resolve('@tailwindcss/vite')
  // SAFETY: the module is the Tailwind v4 compiler the kit's Vite plugin loads; `compile` and `build` are its public API.
  const node = (await import(createRequire(vite).resolve('@tailwindcss/node'))) as { compile(css: string, options: CompileOptions): Promise<Compiler> }
  const compiler = await node.compile(readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8'), { base: join(process.cwd(), 'src'), onDependency: () => undefined })
  sheet = compiler.build(['dshx:place-seat'])
})

// Vitest runs each package from its root.
const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
const schemes: readonly Scheme[] = ['light', 'dark']

const block = (selector: string): string => {
  const start = roles.indexOf(`${selector} {`)
  return start < 0 ? '' : roles.slice(start, roles.indexOf('}', start))
}
const read = (scheme: Scheme, name: string): Oklch => {
  const own = scheme === 'dark' ? block('  body[data-ds-dark-theme]') : ''
  const base = name.startsWith('nav-tone') ? block('  body') : block('  :root')
  const pattern = new RegExp(`--dshx-${name}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\);`, 'u')
  const match = pattern.exec(own) ?? pattern.exec(base)
  if (match === null) throw new Error(`${name} missing in ${scheme}`)
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) }
}
/** `color-mix(in oklch, a 50%, b)`, as the Settings groups between two identity steps use it. */
const midpoint = (a: Oklch, b: Oklch): Oklch => {
  const delta = ((((b.h - a.h) % 360) + 540) % 360) - 180
  return { l: (a.l + b.l) / 2, c: (a.c + b.c) / 2, h: (a.h + delta / 2 + 360) % 360 }
}
/** `color-mix(in oklab, tone 14%, transparent)` painted over a surface: the browser composites the alpha in sRGB. */
const tile = (tone: Oklch, under: Oklch, alpha = 0.14): Oklch => {
  const channels = (color: Oklch) => [1, 3, 5].map(at => Number.parseInt(PaletteMath.toHex(color).slice(at, at + 2), 16))
  const [top, bottom] = [channels(tone), channels(under)]
  const mixed = bottom.map((value, index) => Math.round(value * (1 - alpha) + (top[index] ?? 0) * alpha))
  return PaletteMath.hexToOklch(`#${mixed.map(value => value.toString(16).padStart(2, '0')).join('')}`)
}

const NAV = ['threads', 'land', 'work', 'agents', 'observe', 'knowledge'] as const
/** Settings' between-tones (settings-shell settings-icons.tsx `between`). */
const BETWEEN = [[1, 7], [2, 4], [6, 5], [1, 5]] as const

const tones = (scheme: Scheme): ReadonlyArray<readonly [string, Oklch]> => {
  const p = PaletteMath.palette({ ...WARM_STONE, scheme })
  return [
    ...NAV.map(id => [`nav ${id}`, read(scheme, `nav-tone-${id}`)] as const),
    ['secondary ink (Inbox, Settings)', p.neutral[9]!] as const,
    ...[1, 2, 3, 4, 5, 6, 7, 8].map(step => [`identity ${step}`, read(scheme, `identity-${step}`)] as const),
    ...BETWEEN.map(([a, b]) => [`identity ${a}/${b}`, midpoint(read(scheme, `identity-${a}`), read(scheme, `identity-${b}`))] as const),
  ]
}

describe('selected-place tile (council round 9 A1)', () => {
  it('compiles one seat utility: the glyph in the tone, the 14% tile only when the place is selected', () => {
    expect(sheet).toContain('color: var(--dshx-nav-tone, currentColor);')
    expect(sheet).toContain("&[data-selected='true']")
    for (const ancestor of ["[aria-current]:not([aria-current='false'])", "[aria-selected='true']", '.dv-active-tab'])
      expect(sheet, ancestor).toContain(ancestor)
    expect(sheet).toContain(") &:not([data-selected='false'])")
    expect(sheet).toContain('background-color: color-mix(in oklab, var(--dshx-nav-tone, currentColor) 14%, transparent);')
    // The seat never sets a size: the caller's geometry stays, so selection never moves a row.
    const seat = sheet.slice(sheet.indexOf('.dshx\\:place-seat {'), sheet.indexOf('}', sheet.indexOf('.dshx\\:place-seat {')))
    expect(seat).not.toMatch(/\b(width|height|padding|margin):/u)
  })

  it('renders a decorative seat with a nav tone or any colour, and a tri-state selection', () => {
    const { container } = render(
      <>
        <PlaceGlyph tone="work" selected>
          <svg />
        </PlaceGlyph>
        <PlaceGlyph toneColor="var(--dshx-identity-7)" size="lg">
          <svg />
        </PlaceGlyph>
        <PlaceGlyph tone="threads" selected={false}>
          <svg />
        </PlaceGlyph>
      </>,
    )
    const [work, identity, off] = [...container.querySelectorAll<HTMLElement>('[data-slot="place-glyph"]')]
    expect(work?.getAttribute('aria-hidden')).toBe('true')
    expect(work?.className).toContain('dshx:place-seat')
    expect(work?.className).toContain(PLACE_TONE_CLASS.work)
    expect(work?.className).toContain('dshx:size-6')
    expect(work?.dataset['selected']).toBe('true')
    expect(identity?.style.getPropertyValue('--dshx-nav-tone')).toBe('var(--dshx-identity-7)')
    expect(identity?.className).toContain('dshx:size-7')
    expect(identity?.dataset['selected']).toBeUndefined()
    expect(off?.dataset['selected']).toBe('false')
    expect(placeToneStyle('red')).toEqual({ '--dshx-nav-tone': 'red' })
  })

  it.each(schemes)('draws every glyph at 3:1 and the ink label at AA on its tile over bg, panel, raised and the selected wash (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const surfaces = [['bg', p.neutral[0]!], ['panel', p.neutral[1]!], ['raised', p.neutral[2]!], ['selected wash', p.selectedWash]] as const
    for (const [name, tone] of tones(scheme))
      for (const [surface, under] of surfaces) {
        const seat = tile(tone, under)
        expect(PaletteMath.contrastRatio(tone, seat), `${name} glyph on its tile over ${surface}`).toBeGreaterThanOrEqual(3)
        expect(PaletteMath.contrastRatio(p.neutral[10]!, seat), `ink label beside ${name} tile over ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
  })
})
