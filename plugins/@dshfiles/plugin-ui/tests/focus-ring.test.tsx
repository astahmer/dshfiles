import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest runs each package from its root; jsdom gives import.meta.url a non-file scheme here.
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')

/** The top-level (unlayered) part of the sheet: what is outside every `@layer … { … }` block. */
const unlayered = (css: string): string => {
  let out = ''
  let index = 0
  for (const match of css.matchAll(/@layer [\w, -]+\{/gu)) {
    if (match.index < index) continue
    out += css.slice(index, match.index)
    let depth = 1
    let cursor = match.index + match[0].length
    while (depth > 0 && cursor < css.length) {
      if (css[cursor] === '{') depth += 1
      else if (css[cursor] === '}') depth -= 1
      cursor += 1
    }
    index = cursor
  }
  return out + css.slice(index)
}

describe('one focus ring (round four D15, DESIGN.md Focus ring)', () => {
  const sheet = unlayered(styles)
  const ring = /([^{}]*):focus-visible:not\(\[aria-invalid='true'\]\)([^{]*)\{([^}]*)\}/u.exec(sheet)

  it('draws a 2px solid accent outline, 1px out, on :focus-visible inside a kit root, unlayered so it beats every utility', () => {
    expect(ring).not.toBeNull()
    const [, selector = '', , body = ''] = ring ?? []
    expect(selector).toContain('.dshx-root')
    expect(selector).toContain("[data-slot$='-content']")
    expect(body).toContain('outline: 2px solid var(--dsw-alias-state-business-primary)')
    expect(body).toContain('outline-offset: 1px')
    // The shadow halo (`ring-[3px] ring-ring/50`) is cleared, so only the outline draws.
    expect(body).toContain('--tw-ring-shadow: 0 0 transparent')
    expect(body).not.toMatch(/transition/u)
  })

  it('insets the ring inside a clipping list or a tab strip, at the weight of the ring rule so it wins', () => {
    const inset = /([^{}]*\[data-focus-inset\][^{]*\[role='tab'\][^{]*:focus-visible[^{]*)\{\s*outline-offset: -2px;/u.exec(sheet)
    expect(inset).not.toBeNull()
    // Same :not() chain as the ring rule: a lighter selector loses to it whatever the order.
    expect(inset?.[1]).toContain(ring?.[2]?.trim() ?? 'missing')
    expect(sheet.indexOf(inset?.[0] ?? '')).toBeGreaterThan(sheet.indexOf(ring?.[0] ?? ''))
  })

  it('leaves an invalid field to its own destructive ring, and menu rows and popover panels to their highlight', () => {
    expect(ring?.[0]).toContain(":not([aria-invalid='true'])")
    for (const excluded of ["[role^='menuitem']", "[role='option']", "[data-slot$='-content']"]) expect(ring?.[2]).toContain(excluded)
  })
})
