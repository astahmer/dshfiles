import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const client = readFileSync(new URL('client.tsx', import.meta.url), 'utf8')

/** The list header's row under Search threads: the project picker and the Filter menu trigger. */
const headerRow = client.slice(client.indexOf('<header className="dshx:px-2 dshx:py-1 dshx:pointer-coarse:py-0 dshx:phone:px-3 dshx:phone:pb-1.5">'), client.indexOf('data-preset-edited='))

describe('thread list filter row grammar (council round 8 B2)', () => {
  it('draws the project picker in the field look: no stripped border, fill or heading type', () => {
    expect(headerRow).toContain('triggerClassName="dshx:min-w-0 dshx:flex-1 dshx:px-2.5 dshx:phone:px-3"')
    for (const stripped of ['dshx:border-0', 'dshx:bg-transparent', 'dshx:font-medium', 'dshx:text-base'])
      expect(headerRow, stripped).not.toMatch(new RegExp(`triggerClassName="[^"]*${stripped}[ "]`, 'u'))
  })

  it('draws the Filter trigger in the field look beside it, at the same height, with its value in ink', () => {
    expect(headerRow).toContain('variant="field"')
    expect(headerRow).not.toContain("variant={listFiltered ? 'secondary' : 'ghost'}")
    expect(headerRow).toContain('className="dshx:max-w-[50%] dshx:min-w-0 dshx:shrink dshx:gap-1 dshx:px-2 dshx:phone:px-3"')
    // Two field edges side by side keep 8px between them.
    expect(headerRow).toContain('<div className="dshx:flex dshx:items-center dshx:gap-2">')
  })
})
