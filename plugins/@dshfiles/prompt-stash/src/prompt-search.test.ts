import { describe, expect, it } from 'vitest'
import { matchesPromptSearch, promptSearchFilter } from './prompt-search.js'

const savedPromptValue = (input: { readonly title: string; readonly text: string }): string =>
  `00000000-0000-4000-8000-000000000001 ${input.title} ${input.text}`

const saveValue = (text: string): string => savedPromptValue({ title: 'Title', text })

describe('prompt search filter', () => {
  it('keeps every row while the search box is empty or blank', () => {
    const value = savedPromptValue({ title: 'Release notes', text: 'Summarize the changes since the last tag.' })
    expect(matchesPromptSearch({ value, search: '' })).toBe(true)
    expect(matchesPromptSearch({ value, search: '   ' })).toBe(true)
  })

  it('matches text anywhere in a long prompt body, not only in its preview', () => {
    const body = `${'filler sentence '.repeat(1_200)}deployment-checklist`
    const value = savedPromptValue({ title: 'Agent brief', text: body })
    expect(matchesPromptSearch({ value, search: 'deployment-checklist' })).toBe(true)
    expect(matchesPromptSearch({ value, search: 'deployment checklist' })).toBe(true)
  })

  it('matches case-insensitively and in subsequence order', () => {
    const value = savedPromptValue({ title: 'Saved prompt', text: 'Review the diff before merging.' })
    expect(matchesPromptSearch({ value, search: 'DIFF' })).toBe(true)
    expect(matchesPromptSearch({ value, search: 'rvdf' })).toBe(true)
    expect(matchesPromptSearch({ value, search: 'diffreview' })).toBe(false)
  })

  it('rejects a search that appears nowhere in the row', () => {
    const value = savedPromptValue({ title: 'Saved prompt', text: 'Review the diff before merging.' })
    expect(matchesPromptSearch({ value, search: 'deployment' })).toBe(false)
  })

  it('scores every match alike so the list keeps its own order while typing', () => {
    expect(promptSearchFilter(saveValue('alpha'), 'alpha')).toBe(1)
    expect(promptSearchFilter(saveValue('alpha beta'), 'beta')).toBe(1)
    expect(promptSearchFilter(saveValue('alpha'), 'gamma')).toBe(0)
  })
})
