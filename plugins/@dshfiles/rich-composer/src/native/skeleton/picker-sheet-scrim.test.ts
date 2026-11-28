import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ConversationRoot.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')

/**
 * Council round 31, item 2: the phone composer pickers (project, model, access) became sheets whose dim was a spread of
 * 30% of the text ink, which is near-white in dark, so the page behind brightened (#4D4B4A dark, #868584 light). Popper
 * and menu sheets dim with the kit scrim; a dialog already draws its own overlay, so it keeps only its elevation.
 */
describe('the composer picker sheet scrim', () => {
  it('never mixes the text ink into a dim', () => {
    expect(css).not.toMatch(/100vmax color-mix\(in oklch, var\(--dshx-tone-text/u)
  })

  it('dims a popper or menu sheet with var(--dshx-scrim)', () => {
    const rule = /\[data-radix-popper-content-wrapper\] > \[data-slot\]\)[^{]*\{([^}]*box-shadow[^}]*)\}/u.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/0 0 0 100vmax var\(--dshx-scrim/u)
  })

  it("draws no spread on a dialog sheet, whose overlay already dims the page", () => {
    const rule = /\[role='dialog'\]\[data-slot='dialog-content'\]\)\s*\{\s*box-shadow:\s*([^;]*);/u.exec(css)?.[1] ?? ''
    expect(rule).toContain('var(--dshx-elevation-3)')
    expect(rule).not.toContain('100vmax')
  })
})
