import { describe, expect, it } from 'vitest'
import { viewForShortcut } from './modifier-hints.js'
import { views } from './panel-preferences.js'

describe('backlog tab digit shortcuts', () => {
  it('maps digits to tabs in the order the tab bar renders them', () => {
    expect(views.map((_, index) => viewForShortcut(String(index + 1)))).toEqual([...views])
  })

  it('ignores keys that no tab owns', () => {
    expect(viewForShortcut('0')).toBeUndefined()
    expect(viewForShortcut(String(views.length + 1))).toBeUndefined()
    expect(viewForShortcut('j')).toBeUndefined()
    expect(viewForShortcut('ArrowDown')).toBeUndefined()
  })
})
