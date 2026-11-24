import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const line = readFileSync(new URL('./turn-summary-line.tsx', import.meta.url), 'utf8')
/** The class string of the line's root, the element that carries `data-dshfiles-turn-summary`. */
const rootClasses = /<div className="([^"]*)" data-dshfiles-turn-summary="">/.exec(line)?.[1] ?? ''

describe('the turn summary line', () => {
  it('is as wide as its content, capped at the prose measure (DESIGN.md, layout: transcript measure)', () => {
    expect(rootClasses).toContain('dshx:w-fit')
    expect(rootClasses).toContain('dshx:max-w-[var(--dsh-chat-prose-measure,100%)]')
  })
})
