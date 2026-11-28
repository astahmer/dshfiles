import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
const tagOf = (text: string, marker: string): string => {
  const at = text.indexOf(marker)
  return text.slice(text.lastIndexOf('<', at), text.indexOf('>\n', at))
}

describe('details body under its header (council picker round 4, T10)', () => {
  it('draws a hairline under the header only while the body is scrolled', () => {
    const details = source('model-details.tsx')
    expect(tagOf(details, 'data-model-details-header')).toMatch(/dshx:border-b dshx:border-transparent[^"]*dshx:data-\[scrolled\]:border-border/u)
    expect(details).toContain('onScroll={event => setScrolled(event.currentTarget.scrollTop > 0)}')
  })

  it('brings the Fallbacks heading to the top of the body when the user opens it', () => {
    const fallbacks = source('fallbacks-section.tsx')
    expect(fallbacks).toMatch(/if \(!props\.expanded\) opening\.current = true/u)
    expect(fallbacks.match(/onClick=\{toggle\}/gu) ?? []).toHaveLength(2)
    expect(fallbacks).toMatch(/body\.scrollTo\(\{ top, behavior: still \? 'auto' : 'smooth' \}\)/u)
  })

  it('starts the heading, Add fallback and the rank numbers on one left edge, the help icon beside the label', () => {
    const fallbacks = source('fallbacks-section.tsx')
    expect(tagOf(fallbacks, 'data-model-fallbacks-toggle')).not.toMatch(/flex-1|justify-between/u)
    expect(tagOf(fallbacks, "data-model-fallback-add")).toMatch(/dshx:px-0!/u)
    expect(tagOf(fallbacks, 'data-model-fallback-rank')).not.toMatch(/text-right/u)
    expect(tagOf(fallbacks, 'data-model-fallback-rung')).not.toMatch(/dshx:pl-/u)
  })
})
