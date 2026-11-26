import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/native/chat/RunFold.module.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (selector: string): string => new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''

describe('run fold summary glyph (council round 22, item 2)', () => {
  it('sits beside the label, not detached at the row end', () => {
    // A growing label pushed the glyph (the red cross of a failed run) to the far right of the transcript column.
    expect(rule('.label')).toMatch(/flex:\s*0 1 auto/)
    expect(rule('.label')).toMatch(/min-width:\s*0/)
    expect(rule('.glyph')).toMatch(/flex:\s*none/)
  })
})
