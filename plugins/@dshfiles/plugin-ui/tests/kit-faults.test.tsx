import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buttonVariants } from '../src/components/ui/button.js'
import { Tabs, TabsList, TabsTrigger } from '../src/components/ui/tabs.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../src/components/ui/tooltip.js'
import { PaletteMath, WARM_STONE } from '../src/theme/palette.js'

// Vitest runs each package from its root; jsdom gives import.meta.url a non-file scheme here.
const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')
const styles = read('src/styles.css')
const roles = read('src/color-roles.css')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('phone page top (round four item 4)', () => {
  it('hides the page count with the h1 while the phone top bar names the page', () => {
    const rule = /html:has\(\[data-phone-top-bar\]:not\(\[data-phone-stage='thread'\]\)\) :where\(([^{]*)\)\s*\{/u.exec(styles)
    expect(rule?.[1]).toContain("[data-slot='page-header'] h1")
    expect(rule?.[1]).toContain("[data-slot='page-header'] [data-slot='page-count']")
  })
})

describe('dshx-hit-44', () => {
  it('is a plain class whose ::after widens the hit area to 44px on a coarse pointer only', () => {
    const coarse = styles.slice(styles.indexOf('@media (pointer: coarse)'))
    expect(coarse).toMatch(/:where\(\.dshx-hit-44\)\s*\{\s*position: relative;/u)
    expect(coarse).toMatch(/:where\(\.dshx-hit-44\)::after\s*\{\s*content: '';\s*position: absolute;\s*inset: min\(0px, calc\(\(100% - 44px\) \/ 2\)\) min\(0px, calc\(\(100% - 44px\) \/ 2\)\);/u)
    expect(styles.slice(0, styles.indexOf('.dshx-hit-44'))).toContain('@media (pointer: coarse)')
  })
})

describe('inactive tab ink', () => {
  it('uses the secondary text step (AA on the tab strip), not foreground at 60%', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Active</TabsTrigger>
          <TabsTrigger value="b">Inactive</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const inactive = screen.getByRole('tab', { name: 'Inactive' }).className
    expect(inactive).toContain('dshx:text-muted-foreground')
    expect(inactive).not.toContain('dshx:text-foreground/60')
    // The strip is `bg-muted` (neutral step 2); secondary text (step 9) holds 4.5:1 on it in both schemes.
    for (const scheme of ['light', 'dark'] as const) {
      const p = PaletteMath.palette({ ...WARM_STONE, scheme })
      const [text, strip] = [p.neutral[9], p.neutral[2]]
      if (text === undefined || strip === undefined) throw new Error('palette steps missing')
      expect(PaletteMath.contrastRatio(text, strip)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('destructive button in dark', () => {
  it('draws white on a solid darker red, not on the 60% tint', () => {
    const classes = buttonVariants({ variant: 'destructive' })
    expect(classes).toContain('dshx:bg-destructive-solid')
    expect(classes).not.toContain('dshx:dark:bg-destructive/60')
    expect(roles).toContain('--color-destructive-solid: var(--dshx-destructive-solid);')
  })

  it('holds 4.5:1 for white text in both schemes', () => {
    const mix = /body\[data-ds-dark-theme\]\s*\{[^}]*--dshx-destructive-solid: color-mix\(in oklch, var\(--dsw-alias-state-error-primary\) (\d+)%, black\);/u.exec(roles)
    expect(mix).not.toBeNull()
    const share = Number(mix?.[1]) / 100
    const white = { l: 1, c: 0, h: 0 }
    const light = PaletteMath.palette({ ...WARM_STONE, scheme: 'light' }).danger.fg
    const dark = PaletteMath.palette({ ...WARM_STONE, scheme: 'dark' }).danger.fg
    // color-mix with black in oklch scales lightness and chroma and keeps the hue (black's hue is powerless).
    const darkSolid = { l: dark.l * share, c: dark.c * share, h: dark.h }
    expect(PaletteMath.contrastRatio(white, light)).toBeGreaterThanOrEqual(4.5)
    expect(PaletteMath.contrastRatio(white, darkSolid)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('required-field mark', () => {
  it('is muted: red means Failed only', () => {
    const form = read('src/form.tsx')
    const mark = /<span aria-hidden className="([^"]*)">\s*\*\s*<\/span>/u.exec(form)
    expect(mark?.[1]).toContain('dshx:text-muted-foreground')
    expect(mark?.[1]).not.toContain('destructive')
  })
})

describe('tooltips on a device without hover', () => {
  const stubHover = (none: boolean): void => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    )
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(hover: none)' ? none : false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      })),
    )
  }
  const renderTooltip = () =>
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>Ask to fix</TooltipTrigger>
          <TooltipContent>Writes a request in the composer</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )

  it('does not open from a tap (focus or an emulated hover) where nothing can hover', () => {
    stubHover(true)
    renderTooltip()
    const trigger = screen.getByRole('button', { name: 'Ask to fix' })
    act(() => {
      fireEvent.pointerMove(trigger, { pointerType: 'mouse' })
      fireEvent.focus(trigger)
    })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('still opens on focus where a pointer can hover', () => {
    stubHover(false)
    renderTooltip()
    act(() => {
      fireEvent.focus(screen.getByRole('button', { name: 'Ask to fix' }))
    })
    expect(screen.queryAllByText('Writes a request in the composer').length).toBeGreaterThan(0)
  })
})
