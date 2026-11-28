import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FallbackFocus } from '../src/fallbacks-section.js'

describe('focus after a fallback is removed (council picker round 6, V7)', () => {
  it('goes to the route now at the removed rank, else the last one, else Add fallback', () => {
    expect(FallbackFocus.afterRemove({ index: 0, count: 2 })).toBe(0)
    expect(FallbackFocus.afterRemove({ index: 2, count: 2 })).toBe(1)
    expect(FallbackFocus.afterRemove({ index: 0, count: 0 })).toBe(-1)
  })

  it('keeps Radix from returning focus to the gone trigger, and announces the removal', () => {
    const source = readFileSync(new URL('../src/fallbacks-section.tsx', import.meta.url), 'utf8')
    expect(source).toContain('if (focusAfterRemove.current !== null) event.preventDefault()')
    expect(source).toContain('setMoved(`${row.model} on ${row.account} removed`)')
    expect(source).toContain('onSelect={() => removeAt(index)}')
  })
})
