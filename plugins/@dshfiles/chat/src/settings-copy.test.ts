import { describe, expect, it } from 'vitest'
import { en } from './native/locale.ts'

/** Settings titles in English are sentence case: only the first word starts with a capital. Descriptions may quote
 * capitalised option names ("Summary", "Verbose"), so only titles are checked word by word. */
describe('chat settings copy', () => {
  const settingsCopy = Object.entries(en).filter(([key]) => key.startsWith('settings.') && key.endsWith('.title'))

  it('has settings titles to check', () => {
    expect(settingsCopy.length).toBeGreaterThan(5)
  })

  it.each(settingsCopy)('%s is sentence case', (_key, text) => {
    const laterWords = text.split(/\s+/).slice(1)
    expect(laterWords.filter(word => /^[A-Z][a-z]/.test(word))).toEqual([])
  })

  it('names the collapse setting in sentence case', () => {
    expect(en['settings.collapse.title']).toBe('When to collapse work details')
    expect(en['settings.collapse.description']).toBe('Choose when to automatically collapse work details')
  })
})
