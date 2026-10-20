import { describe, expect, it } from 'vitest'
import { settledAgeLabel } from './settled-age.js'

describe('settledAgeLabel', () => {
  it('withholds the settle age while it only restates the settled banner label', () => {
    expect(settledAgeLabel('now')).toBeUndefined()
  })

  it('dates the thread once the settle age adds information', () => {
    expect(settledAgeLabel('1m')).toBe('1m')
    expect(settledAgeLabel('2h')).toBe('2h')
  })
})
