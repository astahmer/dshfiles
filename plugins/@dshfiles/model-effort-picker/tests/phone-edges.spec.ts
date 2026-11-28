import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
const tagOf = (text: string, marker: string): string => {
  const at = text.indexOf(marker)
  return text.slice(text.lastIndexOf('<', at), text.indexOf('>\n', at))
}

describe('phone edges on one line (council picker round 5, U13)', () => {
  it("starts Back's arrow on Account's edge while its 44 pt box stays inside the sheet", () => {
    // An 8 px pull (the pane's inset) and the arrow 8 px into its box: a 14 px pull clipped the box to 38 px.
    expect(source('model-details.tsx')).toContain('dshx:pointer-coarse:size-11 dshx:pointer-coarse:-ml-2 dshx:pointer-coarse:justify-start dshx:pointer-coarse:pl-2')
  })

  it("ends the Fallbacks chevron and the fallback actions on Close's glyph edge, and the select bar without an inset", () => {
    const fallbacks = source('fallbacks-section.tsx')
    expect(tagOf(fallbacks, 'data-model-fallbacks-chevron')).toContain('dshx:pointer-coarse:pr-1.5')
    // Inside the row (a negative margin overflowed the details body): the glyph sits 2 px in, on Close's glyph edge.
    expect(tagOf(fallbacks, 'data-model-fallback-actions')).toContain('dshx:pointer-coarse:justify-end dshx:pointer-coarse:pr-0.5')
    expect(tagOf(fallbacks, 'data-model-fallback-actions')).not.toMatch(/-mr-/u)
    expect(source('fan-out-bar.tsx')).toContain('dshx:border-t dshx:border-border dshx:px-0 dshx:pt-1.5')
  })

  it("ends each list row on the sheet's edge on touch, so its chevron glyph meets Close's", () => {
    expect(source('model-row.tsx')).toContain('dshx:pr-0.5 dshx:pointer-coarse:pr-0')
  })
})
