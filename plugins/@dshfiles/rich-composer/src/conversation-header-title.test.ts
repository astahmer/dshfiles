import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('./native/skeleton/ConversationRoot.module.css', import.meta.url)), 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`. */
const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'u').exec(css)?.[1] ?? ''
}

describe('the thread title in the conversation header', () => {
  it('takes the room the row has instead of stopping at a fixed width', () => {
    // An ancestor crumb stays capped, so a long lineage cannot push the current title out.
    expect(rule('.crumb')).toContain('max-width: 220px')
    const current = rule('.crumb.crumbCurrent')
    expect(current).toContain('max-width: none')
    // It truncates with an ellipsis only when the row is full: a flex item shrinks no further than its content
    // unless its minimum width is lifted.
    expect(current).toContain('min-width: 0')
  })

  it('caps the title at 45% of the row only in a narrow header, where the chips wrap under it', () => {
    const capped = /@container \(max-width: 36rem\) \{[^@]*?\.crumbs \{[^}]*max-width: max\(45%, 140px\)/u
    expect(css).toMatch(capped)
    // No such cap outside the container query: a wide row leaves the title all the room up to the status chip.
    expect(css.replace(/@container \(max-width: 36rem\) \{[\s\S]*?\n\}\n/u, '')).not.toContain('max(45%, 140px)')
  })
})
