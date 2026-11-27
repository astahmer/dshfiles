import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest runs each package from its root.
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
const theme = readFileSync(join(process.cwd(), '../ui-styles/src/theme.generated.css'), 'utf8')

/**
 * Council round 27, item 7: a phone sheet is the same surface as the popover it replaces, so the tokens on it mean what
 * they mean on a desktop. It took the raised grey, where a chip's trigger fill and a selected wash fell one step off
 * their own surface (a selected chip vanished on the light sheet).
 */
describe('phone sheet fill', () => {
  const sheetRule = /html\[data-shell-phone-nav\]:not\(\[data-phone-keyboard\]\)\s*:is\([^)]*'popover-content'[^)]*\)[^{]*\{([^}]*)\}/u.exec(styles)?.[1] ?? ''

  it('paints the popover fill (--dsw-alias-bg-layer-2), not the raised step', () => {
    expect(sheetRule).toMatch(/background:\s*var\(--dsw-alias-bg-layer-2\)\s*!important/u)
    expect(sheetRule).not.toContain('--dshx-tone-raised')
  })

  it('is paper in light and the #23201D step in dark, as the desktop popover', () => {
    const darkAt = theme.indexOf('body[data-ds-dark-theme]')
    const [light, dark] = [theme.slice(0, darkAt), theme.slice(darkAt)]
    expect(/--dsw-alias-bg-layer-2:\s*var\(--dshx-tone-0\)/u.test(light ?? '')).toBe(true)
    expect(/--dsw-alias-bg-layer-2:\s*var\(--dshx-tone-2\)/u.test(dark ?? '')).toBe(true)
  })
})

/**
 * Council round 30, item 3: the sheet's scrim mixed 30% of the text ink, which is near-white in dark, so opening a sheet
 * brightened the page (#15120f → #55524f, #817e7c with a sheet opened from a sheet). It is the kit scrim token, and a sheet
 * opened from another sheet draws no second one.
 */
describe('phone sheet scrim', () => {
  const sheetRule = /html\[data-shell-phone-nav\]:not\(\[data-phone-keyboard\]\)\s*:is\([^)]*'popover-content'[^)]*\)[^{]*\{([^}]*)\}/u.exec(styles)?.[1] ?? ''
  it('dims with var(--dshx-scrim), never a mix of the text ink', () => {
    expect(sheetRule).toMatch(/0 0 0 100vmax var\(--dshx-scrim/u)
    expect(sheetRule).not.toContain('--dshx-tone-text')
    expect(styles).not.toMatch(/100vmax color-mix\(in oklch, var\(--dshx-tone-text/u)
  })

  it('draws no second scrim for a sheet nested in a sheet, or opened in a later layer while one is open', () => {
    const nested = /([^{}]*:has\([^{}]*\)\s*~\s*\*[^{}]*)\{\s*box-shadow:\s*var\(--dshx-elevation-3\)\s*!important;\s*\}/u.exec(styles)
    expect(nested).not.toBeNull()
    expect(nested?.[1]).toMatch(/body\s*>\s*:has\(/u)
  })
})
