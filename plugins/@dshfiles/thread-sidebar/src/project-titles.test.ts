import { describe, expect, it } from 'vitest'
import { uniqueProjectTitle } from './project-titles.js'

describe('unique project titles', () => {
  it('keeps a title no other project holds', () => {
    expect(uniqueProjectTitle({ desired: 'dshfiles', taken: ['memory', 'ui-styles'] })).toBe('dshfiles')
  })

  it('suffixes a title that is already taken', () => {
    expect(uniqueProjectTitle({ desired: 'dshfiles', taken: ['dshfiles'] })).toBe('dshfiles 2')
    expect(uniqueProjectTitle({ desired: 'dshfiles', taken: ['dshfiles', 'dshfiles 2', 'dshfiles 4'] })).toBe('dshfiles 3')
  })

  it('trims the requested title before comparing it', () => {
    expect(uniqueProjectTitle({ desired: '  dshfiles  ', taken: [] })).toBe('dshfiles')
  })
})
