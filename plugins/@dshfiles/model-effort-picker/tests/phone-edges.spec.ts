import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
const tagOf = (text: string, marker: string): string => {
  const at = text.indexOf(marker)
  return text.slice(text.lastIndexOf('<', at), text.indexOf('>\n', at))
}

describe('phone edges on one line (council picker round 5, U13)', () => {
  it("pulls Back 14 px left so its glyph starts on Account's edge", () => {
    expect(source('model-details.tsx')).toContain('dshx:pointer-coarse:size-11 dshx:pointer-coarse:-ml-3.5')
  })

  it("ends the Fallbacks chevron and the fallback actions on Close's glyph edge, and the select bar without an inset", () => {
    const fallbacks = source('fallbacks-section.tsx')
    expect(tagOf(fallbacks, 'data-model-fallbacks-chevron')).toContain('dshx:pointer-coarse:pr-1.5')
    expect(tagOf(fallbacks, 'data-model-fallback-actions')).toContain('dshx:pointer-coarse:-mr-2')
    expect(source('fan-out-bar.tsx')).toContain('dshx:border-t dshx:border-border dshx:px-0 dshx:pt-1.5')
  })

  it("ends each list row on the sheet's edge on touch, so its chevron glyph meets Close's", () => {
    expect(source('model-row.tsx')).toContain('dshx:pr-0.5 dshx:pointer-coarse:pr-0')
  })
})
