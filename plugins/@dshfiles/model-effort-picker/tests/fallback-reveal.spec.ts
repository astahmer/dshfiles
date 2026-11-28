import { describe, expect, it } from 'vitest'
import { FallbackReveal } from '../src/fallbacks-section.js'

describe('opening Fallbacks shows what it revealed (council picker round 6, V2)', () => {
  it('stays when the first route or Add fallback is already in view', () => {
    expect(FallbackReveal.scrollTop({ body: { bottom: 600 }, scrollTop: 40, target: { bottom: 580 } })).toBe(40)
  })

  it('scrolls just far enough to show the whole target', () => {
    expect(FallbackReveal.scrollTop({ body: { bottom: 600 }, scrollTop: 40, target: { bottom: 644 } })).toBe(84)
  })
})
