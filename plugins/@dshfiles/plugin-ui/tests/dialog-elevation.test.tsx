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
    expect(dark).toContain('--dshx-dialog-fill: oklch(0.24 0.006 60);')
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
    const fill: Oklch = { l: 0.24, c: 0.006, h: 60 }
    for (const step of [8, 9, 10]) expect(PaletteMath.contrastRatio(p.neutral[step]!, fill), `step ${step}`).toBeGreaterThanOrEqual(4.5)
    expect(PaletteMath.contrastRatio(p.neutral[9]!, whiteOver(fill, 0.08)), 'keycap text').toBeGreaterThanOrEqual(4.5)
    // The dialog still reads above the page it covers.
    expect(fill.l).toBeGreaterThan(p.neutral[1]!.l)
  })
})
