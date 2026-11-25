import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const line = readFileSync(new URL('./turn-summary-line.tsx', import.meta.url), 'utf8')
/** The class string of the line's root, the element that carries `data-dshfiles-turn-summary`. */
const rootClasses = /<div className="([^"]*)" data-dshfiles-turn-summary=""/.exec(line)?.[1] ?? ''

describe('the turn summary line', () => {
  it('is as wide as its content, capped at the prose measure (DESIGN.md, layout: transcript measure)', () => {
    expect(rootClasses).toContain('dshx:w-fit')
    expect(rootClasses).toContain('dshx:max-w-[var(--dsh-chat-prose-measure,100%)]')
  })

  it('shares the tool rows\' size: the kit\'s text-sm, 13px (15px on a phone), not text-xs (round three C16)', () => {
    expect(rootClasses).toContain('dshx:text-sm')
    expect(rootClasses).not.toContain('dshx:text-xs')
  })

  it('draws its icon on the first line\'s baseline, beside "Ran N commands" even when a 44px touch target sets that line (F23)', () => {
    const row = /<div className="([^"]*)">\s*<span aria-hidden className="[^"]*">\s*\{'\\u200b'\}\s*<ListChecksIcon/.exec(line)
    expect(row?.[1]).toContain('dshx:items-baseline')
    expect(line).not.toContain('dshx:mt-0.5 dshx:size-3.5')
  })
})
