import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const client = readFileSync(new URL('client.tsx', import.meta.url), 'utf8')

/** The list header's row under Search threads (desktop): the project picker and the Filter menu trigger. */
const headerRow = client.slice(client.indexOf("scopeSlot === null ? 'dshx:px-2 dshx:py-1 dshx:pointer-coarse:py-0 dshx:phone:px-3 dshx:phone:pb-1.5'"), client.indexOf('{filterMenu}'))
/** The one Filter menu, hoisted so a phone can draw it into the search row (council round 10 B1). */
const filterMenu = client.slice(client.indexOf('const filterMenu = ('), client.indexOf('data-preset-edited='))

describe('thread list filter row grammar (council round 8 B2)', () => {
  it('draws the project picker in the field look: no stripped border, fill or heading type', () => {
    expect(headerRow).toContain('triggerClassName="dshx:min-w-0 dshx:flex-1 dshx:px-2.5 dshx:phone:px-3"')
    for (const stripped of ['dshx:border-0', 'dshx:bg-transparent', 'dshx:font-medium', 'dshx:text-base'])
      expect(headerRow, stripped).not.toMatch(new RegExp(`triggerClassName="[^"]*${stripped}[ "]`, 'u'))
  })

  it('draws the Filter trigger as the kit quiet secondary beside it, at the same height (council round 18 B1.4)', () => {
    // One secondary look beside a search field: the trigger fill and hairline, its label in secondary ink at 500, ink
    // while its menu is open. The project picker keeps the field look: it shows a value, not an action.
    expect(filterMenu).toContain('variant="quiet"')
    expect(filterMenu).not.toContain('variant="field"')
    expect(filterMenu).toContain('size="field"')
    expect(filterMenu).not.toContain("variant={listFiltered ? 'secondary' : 'ghost'}")
    expect(filterMenu).toContain("'dshx:max-w-[50%] dshx:min-w-0 dshx:shrink dshx:gap-1 dshx:px-2 dshx:phone:px-3'")
    // Two field edges side by side keep 8px between them.
    expect(headerRow).toContain('<div className="dshx:flex dshx:items-center dshx:gap-2">')
  })
})
