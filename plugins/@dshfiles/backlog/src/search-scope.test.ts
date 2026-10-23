import { describe, expect, it } from 'vitest'

import { SearchScopes } from './search-scope.js'

describe('backlog search scope', () => {
  it('filters the current view while typing', () => {
    const typed = SearchScopes.type(SearchScopes.idle, 'board')

    expect(SearchScopes.filtersView(typed)).toBe(true)
    expect(SearchScopes.showsResults(typed)).toBe(false)
  })

  it('opens the results view only on submit', () => {
    const submitted = SearchScopes.submit(SearchScopes.type(SearchScopes.idle, 'board'))

    expect(SearchScopes.showsResults(submitted)).toBe(true)
    expect(SearchScopes.filtersView(submitted)).toBe(false)
  })

  it('stays on results while refining a submitted query', () => {
    const refined = SearchScopes.type(SearchScopes.submit(SearchScopes.type(SearchScopes.idle, 'boa')), 'board')

    expect(SearchScopes.showsResults(refined)).toBe(true)
  })

  it('ignores a blank submit and resets when the query is cleared', () => {
    expect(SearchScopes.showsResults(SearchScopes.submit(SearchScopes.type(SearchScopes.idle, '   ')))).toBe(false)

    const cleared = SearchScopes.type(SearchScopes.submit(SearchScopes.type(SearchScopes.idle, 'board')), '')
    expect(cleared).toEqual(SearchScopes.idle)
    expect(SearchScopes.showsResults(SearchScopes.type(cleared, 'board'))).toBe(false)
  })

  it('keeps the query as a filter when leaving the results view', () => {
    const left = SearchScopes.leaveResults(SearchScopes.submit(SearchScopes.type(SearchScopes.idle, 'board')))

    expect(left.query).toBe('board')
    expect(SearchScopes.filtersView(left)).toBe(true)
  })

  it('names the projects holding a match, with no project as the empty key', () => {
    expect([...SearchScopes.matchingProjects([{ project: '/repo/a' }, { project: null }, { project: '/repo/a' }])]).toEqual(['/repo/a', ''])
  })
})
