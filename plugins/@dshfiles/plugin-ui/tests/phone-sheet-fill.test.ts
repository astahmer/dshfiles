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

/**
 * Council round 31, item 7: a sheet opened from a sheet shares its fill, so in dark its top edge (the sheet's 1px top
 * border) vanished into the sheet below it. In dark a nested sheet's top edge takes the strong border step (#423F3C, the
 * council's ~#45413C); light is unchanged.
 */
describe('a nested phone sheet in dark', () => {
  it('draws its top edge in the strong border step, only under the dark theme', () => {
    const rule = /([^{}]*body\[data-ds-dark-theme\][^{}]*)\{\s*border-top-color:\s*var\(--dshx-tone-border-strong[^;]*\)\s*!important;\s*\}/u.exec(styles)
    expect(rule).not.toBeNull()
    // The same two nested shapes as the scrim rule: inside a parent sheet, and in a later top-level layer.
    expect(rule?.[1]).toMatch(/body\[data-ds-dark-theme\]\s*:is\(/u)
    expect(rule?.[1]).toMatch(/body\[data-ds-dark-theme\]\s*>\s*:has\(/u)
    const [light] = theme.split('body[data-ds-dark-theme]')
    expect(light).not.toContain('border-top-color')
  })
})
