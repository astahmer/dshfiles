import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/native/chat/RunFold.module.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (selector: string): string => new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''

describe('run fold summary glyph (council round 22, item 2; round 23, item 1)', () => {
  it('ends the row on its label, with no glyph after the count', () => {
    // Round 22: a growing label pushed the glyph to the far right of the column. Round 23: even beside the label, the
    // red cross read as a dismiss control; the failed clause leads with the cross instead (WorkCountText).
    expect(rule('.label')).toMatch(/flex:\s*0 1 auto/)
    expect(rule('.label')).toMatch(/min-width:\s*0/)
    expect(rule('.glyph')).toBe('')
    const view = readFileSync(new URL('../src/native/chat/RunFold.tsx', import.meta.url), 'utf8')
    expect(view).toMatch(/<WorkCountText parts=\{parts\} \/>/)
    expect(view).not.toMatch(/<StatusGlyph/)
  })
})
