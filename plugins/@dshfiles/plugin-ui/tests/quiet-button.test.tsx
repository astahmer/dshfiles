// @vitest-environment jsdom
/**
 * The quiet secondary (council round 18 A3): every action beside a search field (Settings' Modified, a phone ⋯ or
 * Filters, Backlog's View and Filter, the thread list's filters) is one look, the quiet trigger's chip (trigger fill and
 * hairline) with a centred 500 label in secondary ink, ink on hover, while open and pressed. Header actions stay
 * `outline`; a value trigger stays `field`.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Button, buttonVariants } from '../src/components/ui/button.js'
import { quietLook, triggerLook } from '../src/components/ui/input.js'
import { Toggle } from '../src/components/ui/toggle.js'
import { ListFilterIcon } from '../src/icons.js'
import { PaletteMath, WARM_STONE, type Oklch, type Scheme } from '../src/theme/palette.ts'

afterEach(cleanup)

const classesOf = (element: Element): readonly string[] => element.getAttribute('class')?.split(/\s+/u) ?? []
const TRIGGER = triggerLook.split(' ')

/** `over` at `alpha` on an opaque `under`, composited in gamma sRGB as a browser paints it. */
const composite = (under: Oklch, over: Oklch, alpha: number): Oklch => {
  const channels = (color: Oklch): readonly number[] => [1, 3, 5].map(at => Number.parseInt(PaletteMath.toHex(color).slice(at, at + 2), 16))
  const [u, o] = [channels(under), channels(over)]
  return PaletteMath.hexToOklch(`#${u.map((value, i) => Math.round(value * (1 - alpha) + (o[i] ?? 0) * alpha).toString(16).padStart(2, '0')).join('')}`)
}

describe('Button variant="quiet" (council round 18 A3)', () => {
  it('is the quiet trigger chip with a centred 500 label in secondary ink on the one control height', () => {
    render(
      <Button variant="quiet">
        <ListFilterIcon aria-hidden />
        Filters
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Filters' })
    const classes = classesOf(button)
    expect(button.getAttribute('data-variant')).toBe('quiet')
    expect(classes).toEqual(expect.arrayContaining([...TRIGGER, 'dshx:justify-center', 'dshx:font-medium', 'dshx:text-muted-foreground', 'dshx:h-(--dshx-control-h)']))
    expect(classes).toEqual(expect.arrayContaining(['dshx:hover:text-foreground', 'dshx:aria-expanded:text-foreground', 'dshx:aria-pressed:bg-selected-wash']))
    // Not the value trigger: no start-aligned body-weight value in ink.
    expect(classes).not.toContain('dshx:justify-between')
    expect(classes).not.toContain('dshx:font-normal')
    expect(classes).not.toContain('dshx:text-foreground')
    // Not the outlined header action: no page fill or shadow.
    expect(classes).not.toContain('dshx:bg-background')
    expect(classes).not.toContain('dshx:shadow-xs')
  })

  it('is readable outside Button too, and is the exported quietLook', () => {
    expect(buttonVariants({ variant: 'quiet' })).toContain('dshx:bg-trigger-fill')
    for (const name of quietLook.split(' ')) expect(buttonVariants({ variant: 'quiet' }).split(' ')).toContain(name)
  })
})

describe('Toggle variant="quiet" (council round 18 A3)', () => {
  it('shares the chip and marks on with the wash, the field edge and ink, not colour alone', () => {
    render(
      <Toggle variant="quiet" pressed>
        Modified
      </Toggle>,
    )
    const toggle = screen.getByRole('button', { name: 'Modified' })
    const classes = classesOf(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(classes).toEqual(expect.arrayContaining([...TRIGGER, 'dshx:text-muted-foreground', 'dshx:aria-pressed:border-field-border', 'dshx:aria-pressed:bg-selected-wash', 'dshx:aria-pressed:text-foreground']))
    // The base Toggle's muted hover fill and ink would turn the chip grey and its label secondary: the quiet ones win.
    expect(classes).toContain('dshx:hover:bg-trigger-fill')
    expect(classes).not.toContain('dshx:hover:bg-muted')
    expect(classes).not.toContain('dshx:hover:text-muted-foreground')
    expect(classes).not.toContain('dshx:rounded-md')
  })
})

describe('quiet secondary in the compiled sheet', () => {
  let build: (candidates: readonly string[]) => string
  beforeAll(async () => {
    const vite = createRequire(join(process.cwd(), 'package.json')).resolve('@tailwindcss/vite')
    // SAFETY: the module is the Tailwind v4 compiler the kit's Vite plugin loads; `compile` and `build` are its public API.
    const node = (await import(createRequire(vite).resolve('@tailwindcss/node'))) as {
      compile(css: string, options: { base: string; onDependency: (path: string) => void }): Promise<{ build(candidates: readonly string[]): string }>
    }
    const compiler = await node.compile(readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8'), { base: join(process.cwd(), 'src'), onDependency: () => undefined })
    build = candidates => compiler.build(candidates)
  })

  it('compiles the pressed state on aria-pressed="true" and lets it win over hover', () => {
    const sheet = build(quietLook.split(' '))
    const pressed = sheet.indexOf('.dshx\\:aria-pressed\\:bg-selected-wash')
    const hover = sheet.indexOf('.dshx\\:hover\\:bg-trigger-fill')
    expect(pressed).toBeGreaterThan(0)
    expect(sheet.slice(pressed, sheet.indexOf('}', pressed))).toContain('[aria-pressed="true"]')
    expect(hover).toBeGreaterThan(0)
    expect(pressed).toBeGreaterThan(hover)
  })
})

describe('quiet secondary contrast', () => {
  it.each<Scheme>(['light', 'dark'])('keeps the secondary label AA on the chip over every surface, and ink AA when pressed (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const fill = p.triggerFill
    const surfaces = { bg: p.neutral[0]!, panel: p.neutral[1]!, raised: p.neutral[2]!, nav: p.navSurface }
    for (const [name, surface] of Object.entries(surfaces)) {
      const chip = composite(surface, { ...fill, alpha: 1 }, fill.alpha ?? 1)
      expect(PaletteMath.contrastRatio(p.neutral[9]!, chip), name).toBeGreaterThanOrEqual(4.5)
      // The hairline at rest is quiet by design; the field edge on hover and while pressed bounds the chip at 3:1
      // against the surface around it.
      expect(PaletteMath.contrastRatio(p.fieldBorder, surface), name).toBeGreaterThanOrEqual(3)
    }
    expect(PaletteMath.contrastRatio(p.neutral[10]!, p.selectedWash)).toBeGreaterThanOrEqual(4.5)
  })
})
