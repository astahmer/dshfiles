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
