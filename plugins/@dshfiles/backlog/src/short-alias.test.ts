import { describe, expect, it } from 'vitest'

import { BacklogReference } from './backlog-reference.js'
import { ShortAlias } from './short-alias.js'

const sequence = (values: readonly number[]) => {
  let index = 0
  return (): number => values[index++ % values.length] ?? 0
}

describe('short aliases', () => {
  it('draws four Crockford characters that parse back as a short ref', () => {
    const ref = ShortAlias.mint({ taken: new Set() })
    expect(ref).toMatch(/^[0-9a-hjkmnp-tv-z]{4}$/u)
    expect(BacklogReference.parse(ref)).toBe(ref)
    expect(BacklogReference.isLegacy(ref)).toBe(false)
  })

  it('redraws an all-digit alias, which would read as a legacy number', () => {
    // 1,2,3,4 → "1234" (digits only), then 20,3,15,9 → "m3f9"
    expect(ShortAlias.mint({ taken: new Set(), pick: sequence([1, 2, 3, 4, 20, 3, 15, 9]) })).toBe('m3f9')
  })

  it('redraws an alias another item holds', () => {
    expect(ShortAlias.mint({ taken: new Set(['m3f9']), pick: sequence([20, 3, 15, 9, 10, 3, 15, 9]) })).toBe('a3f9')
  })

  it('grows to five characters once a fifth of the four-character space is used', () => {
    const ref = ShortAlias.mint({ taken: { size: ShortAlias.growAt, has: () => false } })
    expect(ref).toHaveLength(5)
  })
})
