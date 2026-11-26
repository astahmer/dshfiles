// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Button, buttonVariants } from '../src/components/ui/button.js'
import { cn } from '../src/lib/utils.js'
import { PaletteMath, WARM_STONE, type Oklch, type Scheme } from '../src/theme/palette.ts'

afterEach(cleanup)

// Vitest runs each package from its root; jsdom gives import.meta.url a non-file scheme here.
const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
const schemes: readonly Scheme[] = ['light', 'dark']
/** Where a row verb sits: the page, a panel, a raised card and a selected row. */
const surfaces = { bg: 0, panel: 1, raised: 2, selected: 3 } as const

const classes = (variant: 'attention' | 'danger-tint'): readonly string[] => buttonVariants({ variant }).split(/\s+/)

/** `over` at `alpha` on an opaque `under`, composited in gamma sRGB as a browser paints it. */
const composite = (under: Oklch, over: Oklch, alpha: number): Oklch => {
  const channels = (color: Oklch): readonly number[] =>
    PaletteMath.toHex(color)
      .slice(1)
      .match(/../g)!
      .map(pair => Number.parseInt(pair, 16))
  const [u, o] = [channels(under), channels(over)]
  return PaletteMath.hexToOklch(`#${u.map((value, i) => Math.round(value * (1 - alpha) + o[i]! * alpha).toString(16).padStart(2, '0')).join('')}`)
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

/** The ink share a `--dshx-<name>-foreground` token mixes into its status colour. */
const inkShare = (name: string, status: string): number => {
  const pattern = new RegExp(`--dshx-${name}-foreground: color-mix\\(in oklab, var\\(--dsw-alias-state-${status}-primary\\) (\\d+)%, var\\(--dsw-alias-label-primary\\)\\);`)
  return 1 - Number(roles.match(pattern)?.[1] ?? 100) / 100
}

/** Tint alphas a variant uses at rest, on hover and when pressed. */
const tintAlphas = (variant: 'attention' | 'danger-tint', status: string): readonly number[] =>
  classes(variant).flatMap(name => {
    const match = name.match(new RegExp(`^dshx:(?:hover:|active:)?bg-status-${status}/(\\d+)$`))
    return match ? [Number(match[1]) / 100] : []
  })

describe('Button tint variants (round five K3)', () => {
  it('draws attention as Needs-you text on its own tint, with no border, and danger-tint with the danger pair', () => {
    render(
      <>
        <Button variant="attention">Review</Button>
        <Button variant="danger-tint">Retry</Button>
      </>,
    )
    const review = screen.getByRole('button', { name: 'Review' })
    expect(review.getAttribute('data-variant')).toBe('attention')
    expect(review.className.split(/\s+/)).toEqual(expect.arrayContaining(['dshx:bg-status-needs-you/12', 'dshx:text-attention-foreground']))
    expect(screen.getByRole('button', { name: 'Retry' }).className.split(/\s+/)).toEqual(
      expect.arrayContaining(['dshx:bg-status-failed/12', 'dshx:text-danger-tint-foreground']),
    )
    for (const variant of ['attention', 'danger-tint'] as const) {
      expect(classes(variant).filter(name => /^dshx:(?:dark:)?border(?:$|-)/.test(name)), variant).toEqual([])
      expect(classes(variant).join(' '), variant).not.toMatch(/bg-primary|bg-destructive-solid/)
    }
  })

  it('exposes the foreground and the rest tint as colour utilities for chips and bands', () => {
    for (const token of [
      '--color-attention-foreground: var(--dshx-attention-foreground);',
      '--color-danger-tint-foreground: var(--dshx-danger-tint-foreground);',
      '--color-attention-tint: color-mix(in oklab, var(--dsw-alias-state-business-primary) 12%, transparent);',
      '--color-danger-tint: color-mix(in oklab, var(--dsw-alias-state-error-primary) 12%, transparent);',
    ])
      expect(roles).toContain(token)
  })

  it.each(schemes)('holds AA text at rest, on hover and pressed over bg, panel, raised and selected (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const pairs = [
      { variant: 'attention', status: 'business', name: 'attention', fg: p.accent.fg, css: 'needs-you' },
      { variant: 'danger-tint', status: 'error', name: 'danger-tint', fg: p.danger.fg, css: 'failed' },
    ] as const
    for (const pair of pairs) {
      const share = inkShare(pair.name, pair.status)
      expect(share, `${pair.name} ink share`).toBeGreaterThan(0)
      const text = mixOklab(pair.fg, p.neutral[10]!, share)
      const alphas = tintAlphas(pair.variant, pair.css)
      expect(alphas, pair.variant).toHaveLength(3)
      for (const alpha of alphas)
        for (const [surface, step] of Object.entries(surfaces))
          expect(PaletteMath.contrastRatio(text, composite(p.neutral[step]!, pair.fg, alpha)), `${pair.variant} at ${alpha} over ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('Button tint variants on a head band (council round 12 A2)', () => {
  const bandClasses = (variant: 'attention' | 'danger-tint', band?: boolean): readonly string[] => cn(buttonVariants({ variant, size: 'sm', band })).split(/\s+/)
  const bandAlphas = (variant: 'attention' | 'danger-tint', status: string): readonly number[] =>
    bandClasses(variant, true).flatMap(name => {
      const match = name.match(new RegExp(`^dshx:(?:hover:|active:)?bg-status-${status}/(\\d+)$`))
      return match ? [Number(match[1]) / 100] : []
    })
  /** The ink share a `--dshx-<name>-band-foreground` token mixes into its status colour, per scheme. */
  const bandInkShare = (name: string, status: string, scheme: Scheme): number => {
    const block = scheme === 'dark' ? roles.slice(roles.indexOf('body[data-ds-dark-theme] {')) : roles.slice(0, roles.indexOf('body[data-ds-dark-theme] {'))
    const pattern = new RegExp(`--dshx-${name}-band-foreground: color-mix\\(in oklab, var\\(--dsw-alias-state-${status}-primary\\) (\\d+)%, var\\(--dsw-alias-label-primary\\)\\);`)
    return 1 - Number(block.match(pattern)?.[1] ?? 100) / 100
  }

  it('marks the verb on the band and swaps its tint to 20% at rest, 26% hover and 32% pressed', () => {
    render(
      <>
        <Button variant="attention" size="sm" band>
          Review
        </Button>
        <Button variant="danger-tint" size="sm" band>
          Retry
        </Button>
      </>,
    )
    const review = screen.getByRole('button', { name: 'Review' })
    expect(review.hasAttribute('data-on-band')).toBe(true)
    expect(screen.getByRole('button', { name: 'Retry' }).hasAttribute('data-on-band')).toBe(true)
    for (const [variant, status, fg] of [
      ['attention', 'needs-you', 'dshx:text-attention-band-foreground'],
      ['danger-tint', 'failed', 'dshx:text-danger-band-foreground'],
    ] as const) {
      expect(bandAlphas(variant, status), variant).toEqual([0.2, 0.26, 0.32])
      expect(bandClasses(variant, true), variant).toContain(fg)
      // tailwind-merge keeps one fill per state: no 12/18/24 left beside the band tints.
      expect(bandClasses(variant, true).filter(name => /bg-status-[a-z-]+\/(?:12|18|24)$/.test(name)), variant).toEqual([])
    }
    // Off the band nothing changes.
    expect(screen.getByRole('button', { name: 'Review' }).className).toContain('dshx:bg-status-needs-you/20')
    render(<Button variant="attention">Plain</Button>)
    expect(screen.getByRole('button', { name: 'Plain' }).hasAttribute('data-on-band')).toBe(false)
    expect(screen.getByRole('button', { name: 'Plain' }).className).toContain('dshx:bg-status-needs-you/12')
  })

  it('keeps the height and padding of the same verb off the band, so both Review verbs are one trigger', () => {
    for (const size of ['default', 'xs', 'sm', 'lg'] as const)
      for (const variant of ['attention', 'danger-tint'] as const) {
        const box = (band: boolean): readonly string[] =>
          cn(buttonVariants({ variant, size, band }))
            .split(/\s+/)
            .filter(name => /^dshx:(?:has-\[>svg\]:)?(?:h|px|py|size|gap)-/.test(name))
        expect(box(true), `${variant} ${size}`).toEqual(box(false))
        expect(box(true), `${variant} ${size}`).toEqual(cn(buttonVariants({ variant: 'attention', size, band: true })).split(/\s+/).filter(name => /^dshx:(?:has-\[>svg\]:)?(?:h|px|py|size|gap)-/.test(name)))
      }
  })

  it.each(schemes)('holds AA text at rest, on hover and pressed over its head band and the plain surfaces (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const pairs = [
      { variant: 'attention', status: 'business', name: 'attention', fg: p.accent.fg, css: 'needs-you', bands: { band: p.needsYouBandWash, row: p.needsYouWash } },
      { variant: 'danger-tint', status: 'error', name: 'danger', fg: p.danger.fg, css: 'failed', bands: { band: p.failedWash } },
    ] as const
    for (const pair of pairs) {
      const share = bandInkShare(pair.name, pair.status, scheme)
      expect(share, `${pair.name} band ink share`).toBeGreaterThan(0)
      const text = mixOklab(pair.fg, p.neutral[10]!, share)
      const unders = { ...pair.bands, ...Object.fromEntries(Object.entries(surfaces).map(([name, step]) => [name, p.neutral[step]!])) }
      for (const alpha of bandAlphas(pair.variant, pair.css))
        for (const [surface, under] of Object.entries(unders))
          expect(PaletteMath.contrastRatio(text, composite(under, pair.fg, alpha)), `${pair.variant} at ${alpha} over ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('Button text variants (council round 8 A1)', () => {
  const textClasses = (variant: 'attention-text' | 'danger-text'): readonly string[] => buttonVariants({ variant }).split(/\s+/)
  const textAlphas = (variant: 'attention-text' | 'danger-text', status: string): readonly number[] =>
    textClasses(variant).flatMap(name => {
      const match = name.match(new RegExp(`^dshx:(hover:|active:)bg-status-${status}/(\\d+)$`))
      return match ? [Number(match[2]) / 100] : []
    })

  it('draws the foreground as text on a transparent fill, the tint only on hover and press', () => {
    render(
      <>
        <Button variant="attention-text">Answer</Button>
        <Button variant="danger-text">Retry</Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Answer' }).getAttribute('data-variant')).toBe('attention-text')
    for (const [variant, status, fg] of [
      ['attention-text', 'needs-you', 'dshx:text-attention-foreground'],
      ['danger-text', 'failed', 'dshx:text-danger-tint-foreground'],
    ] as const) {
      const names = textClasses(variant)
      expect(names, variant).toEqual(expect.arrayContaining(['dshx:bg-transparent', fg, `dshx:hover:bg-status-${status}/12`, `dshx:active:bg-status-${status}/18`]))
      // No fill at rest and no border: the row's wash is the one layer of colour.
      expect(names.filter(name => /^dshx:(?:dark:)?bg-status-/.test(name)), variant).toEqual([])
      expect(names.filter(name => /^dshx:(?:dark:)?border(?:$|-)/.test(name)), variant).toEqual([])
    }
  })

  it('keeps the height and hit area of `attention` at every size', () => {
    for (const size of ['default', 'xs', 'sm', 'lg'] as const) {
      const box = (variant: 'attention' | 'attention-text' | 'danger-text'): readonly string[] =>
        buttonVariants({ variant, size })
          .split(/\s+/)
          .filter(name => /^dshx:(?:has-\[>svg\]:)?(?:h|px|py|size|gap)-/.test(name))
      expect(box('attention-text'), size).toEqual(box('attention'))
      expect(box('danger-text'), size).toEqual(box('attention'))
    }
  })

  it.each(schemes)('holds AA text at rest, on hover and pressed over its row wash and the plain surfaces (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const pairs = [
      { variant: 'attention-text', status: 'business', name: 'attention', fg: p.accent.fg, css: 'needs-you', wash: p.needsYouWash },
      { variant: 'danger-text', status: 'error', name: 'danger-tint', fg: p.danger.fg, css: 'failed', wash: p.failedWash },
    ] as const
    for (const pair of pairs) {
      const text = mixOklab(pair.fg, p.neutral[10]!, inkShare(pair.name, pair.status))
      const alphas = [0, ...textAlphas(pair.variant, pair.css)]
      expect(alphas, pair.variant).toHaveLength(3)
      const unders = { wash: pair.wash, ...Object.fromEntries(Object.entries(surfaces).map(([name, step]) => [name, p.neutral[step]!])) }
      for (const alpha of alphas)
        for (const [surface, under] of Object.entries(unders))
          expect(PaletteMath.contrastRatio(text, composite(under, pair.fg, alpha)), `${pair.variant} at ${alpha} over ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
