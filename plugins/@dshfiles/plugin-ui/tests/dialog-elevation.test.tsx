// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '../src/components/ui/alert-dialog.js'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../src/components/ui/dialog.js'
import { Kbd } from '../src/components/ui/kbd.js'
import { PaletteMath, WARM_STONE, type Oklch } from '../src/theme/palette.ts'

afterEach(cleanup)

const surfaces = readFileSync(join(process.cwd(), 'src/surfaces.css'), 'utf8')
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
const block = (selector: string): string => {
  const start = surfaces.indexOf(`${selector} {`)
  return start < 0 ? '' : surfaces.slice(start, surfaces.indexOf('}', start))
}
const classes = (element: Element | null): readonly string[] => element?.className.split(/\s+/u) ?? []

/** `oklch(1 0 0 / alpha)` over an opaque colour, composited in sRGB as the browser does. */
const whiteOver = (under: Oklch, alpha: number): Oklch => {
  const channels = [1, 3, 5].map(at => Number.parseInt(PaletteMath.toHex(under).slice(at, at + 2), 16))
  const mixed = channels.map(value => Math.round(value * (1 - alpha) + 255 * alpha))
  return PaletteMath.hexToOklch(`#${mixed.map(value => value.toString(16).padStart(2, '0')).join('')}`)
}

describe('dialog and palette elevation (council round 3 A8)', () => {
  it('is a raised fill, a faint light edge and one deep shadow in dark; light keeps the page fill, hairline and s3', () => {
    expect(styles).toContain("@import './surfaces.css';")
    const dark = block('  body[data-ds-dark-theme]')
    expect(dark).toContain('--dshx-dialog-fill: oklch(0.27 0.006 60);')
    expect(dark).toContain('--dshx-dialog-border: oklch(1 0 0 / 0.08);')
    expect(dark).toContain('--dshx-elevation-dialog: 0 24px 64px rgb(0 0 0 / 0.55);')
    const light = block('  body')
    expect(light).toContain('--dshx-dialog-fill: var(--dsw-alias-bg-base);')
    expect(light).toContain('--dshx-dialog-border: var(--dsw-alias-border-l2);')
    expect(light).toContain('--dshx-elevation-dialog: var(--dshx-elevation-3);')
    const utility = /@utility surface-dialog \{([^}]*)\}/u.exec(surfaces)?.[1] ?? ''
    for (const declaration of [
      'background-color: var(--dshx-dialog-fill);',
      'border-color: var(--dshx-dialog-border);',
      'box-shadow: var(--dshx-elevation-dialog);',
    ])
      expect(utility).toContain(declaration)
  })

  it('dresses the kit dialog and alert dialog (and so the command dialog) with it', () => {
    const view = render(
      <>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Rename</DialogTitle>
            <DialogDescription>New name</DialogDescription>
          </DialogContent>
        </Dialog>
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>Delete?</AlertDialogTitle>
            <AlertDialogDescription>It cannot be undone.</AlertDialogDescription>
          </AlertDialogContent>
        </AlertDialog>
      </>,
    )
    for (const slot of ['dialog-content', 'alert-dialog-content']) {
      const content = view.baseElement.querySelector(`[data-slot="${slot}"]`)
      expect(classes(content), slot).toEqual(expect.arrayContaining(['dshx:border', 'dshx:surface-dialog']))
      expect(content?.className, slot).not.toMatch(/(?:^| )dshx:(?:bg-background|shadow-lg)(?: |$)/u)
    }
  })

  it('draws a keycap as a faint light fill with a faint edge in dark, same box in both schemes', () => {
    const dark = block('  body[data-ds-dark-theme]')
    expect(dark).toContain('--dshx-kbd-fill: oklch(1 0 0 / 0.08);')
    expect(dark).toContain('--dshx-kbd-border: oklch(1 0 0 / 0.12);')
    const light = block('  body')
    expect(light).toContain('--dshx-kbd-fill: var(--dsw-alias-bg-module-platform);')
    expect(light).toContain('--dshx-kbd-border: transparent;')
    const view = render(<Kbd>K</Kbd>)
    expect(classes(view.container.querySelector('[data-slot="kbd"]'))).toEqual(
      expect.arrayContaining(['dshx:border', 'dshx:border-(--dshx-kbd-border)', 'dshx:bg-(--dshx-kbd-fill)']),
    )
  })

  it('keeps ink, secondary and faint text at AA on the dark dialog, and keycap text at AA on its cap', () => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme: 'dark' })
    const fill: Oklch = { l: 0.27, c: 0.006, h: 60 }
    for (const step of [8, 9, 10]) expect(PaletteMath.contrastRatio(p.neutral[step]!, fill), `step ${step}`).toBeGreaterThanOrEqual(4.5)
    expect(PaletteMath.contrastRatio(p.neutral[9]!, whiteOver(fill, 0.08)), 'keycap text').toBeGreaterThanOrEqual(4.5)
    // The dialog reads above the page it covers, and clearer than before over the 50% black scrim (round 4 A5).
    expect(fill.l).toBeGreaterThan(p.neutral[2]!.l)
    const scrimmed = (under: Oklch): Oklch => {
      const channels = [1, 3, 5].map(at => Math.round(Number.parseInt(PaletteMath.toHex(under).slice(at, at + 2), 16) * 0.5))
      return PaletteMath.hexToOklch(`#${channels.map(value => value.toString(16).padStart(2, '0')).join('')}`)
    }
    for (const step of [0, 1]) expect(PaletteMath.contrastRatio(fill, scrimmed(p.neutral[step]!)), `fill over scrimmed step ${step}`).toBeGreaterThanOrEqual(1.25)
  })

  it('lifts the selection wash and the faint step inside a dark dialog, so the highlighted row still reads (round 4 A5)', () => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme: 'dark' })
    const fill: Oklch = { l: 0.27, c: 0.006, h: 60 }
    const dark = block('  body[data-ds-dark-theme]')
    expect(dark).toContain('--dshx-dialog-selected-wash: oklch(from var(--dshx-selected-wash) max(l, 0.3) c h);')
    expect(dark).toContain('--dshx-dialog-faint: oklch(from var(--dsw-alias-label-tertiary) max(l, 0.68) c h);')
    const light = block('  body')
    expect(light).toContain('--dshx-dialog-selected-wash: var(--dshx-selected-wash);')
    expect(light).toContain('--dshx-dialog-faint: var(--dsw-alias-label-tertiary);')
    const utility = /@utility surface-dialog \{([^}]*)\}/u.exec(surfaces)?.[1] ?? ''
    expect(utility).toContain('--dshx-selected-wash: var(--dshx-dialog-selected-wash);')
    expect(utility).toContain('--dsw-alias-label-tertiary: var(--dshx-dialog-faint);')
    // The palette's Command root (`bg-popover`) takes the dialog fill: one tone, no inset card.
    expect(utility).toContain('--dsw-alias-bg-layer-2: var(--dshx-dialog-fill);')
    expect(styles).toContain('--color-popover: var(--dsw-alias-bg-layer-2);')
    const selected: Oklch = { ...p.selectedWash, l: Math.max(p.selectedWash.l, 0.3) }
    const faint: Oklch = { ...p.neutral[8]!, l: Math.max(p.neutral[8]!.l, 0.68) }
    // As far off the dialog as the page's selection is off the page's raised step.
    expect(PaletteMath.contrastRatio(selected, fill)).toBeGreaterThanOrEqual(1.1)
    for (const [name, colour] of Object.entries({ faint, muted: p.neutral[9]!, ink: p.neutral[10]!, accent: p.accent.fg, danger: p.danger.fg }))
      expect(PaletteMath.contrastRatio(colour, selected), `${name} on the dialog selection`).toBeGreaterThanOrEqual(4.5)
    // Faint stays below secondary ink.
    expect(faint.l).toBeLessThan(p.neutral[9]!.l)
  })
})
