import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./native/skeleton/InputBar.module.css', import.meta.url), 'utf8')

describe("the composer's context line on a narrow bar (round five C1, council round 5)", () => {
  it('is one 24px line: its 22px items 2px under the card, not 4px', () => {
    const narrow = css.slice(css.indexOf('@container (max-width: 560px) {'), css.indexOf('/* The docked composer reserves'))
    expect(narrow).toMatch(/\.dock:not\(\[data-meter-expanded\]\) \{[^}]*padding-top: 2px;/u)
  })
})
