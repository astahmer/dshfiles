import { describe, expect, it } from 'vitest'
import { FEATURE_CATALOG } from './generated/feature-catalog.js'
import { SuggestionsModel } from './suggestions-model.js'
import { SuggestionsWindow } from './suggestions-window.js'

const suggestions = SuggestionsModel.suggest({
  catalog: FEATURE_CATALOG,
  signals: {
    tools: new Map([['todo_write', 40]]),
    commands: new Map([
      ['jj', 60],
      ['gh', 12],
    ]),
    toolErrors: 0,
    turns: 0,
    longestThreadRequests: 0,
    compactionRequests: 0,
  },
})

const rules = (list: readonly { readonly rule: string }[]): readonly string[] => list.map(entry => entry.rule)

describe('the suggestion window', () => {
  it('features the first suggestion on a first visit and remembers it for today', () => {
    const view = SuggestionsWindow.view({ suggestions, dismissed: [], featured: null, today: '2026-11-11' })
    expect(view.featured?.rule).toBe('jj-without-thread-workspaces')
    expect(rules(view.rest)).toEqual(['jj-without-revision-graph', 'gh-without-pull-requests', 'plans-without-backlog'])
    expect(view.remember).toEqual({ day: '2026-11-11', rule: 'jj-without-thread-workspaces' })
  })

  it('keeps a featured suggestion that still applies on later days without storing again', () => {
    const view = SuggestionsWindow.view({
      suggestions,
      dismissed: [],
      featured: { day: '2026-11-09', rule: 'gh-without-pull-requests' },
      today: '2026-11-11',
    })
    expect(view.featured?.rule).toBe('gh-without-pull-requests')
    expect(view.remember).toBeNull()
  })

  it('shows at most one new suggestion per day: dismissing today’s pick features nothing until tomorrow', () => {
    const featured = { day: '2026-11-11', rule: 'jj-without-thread-workspaces' }
    const today = SuggestionsWindow.view({ suggestions, dismissed: ['jj-without-thread-workspaces'], featured, today: '2026-11-11' })
    expect(today.featured).toBeNull()
    expect(rules(today.rest)).toEqual(['jj-without-revision-graph', 'gh-without-pull-requests', 'plans-without-backlog'])
    expect(today.dismissed).toBe(1)
    expect(today.remember).toBeNull()
    const tomorrow = SuggestionsWindow.view({ suggestions, dismissed: ['jj-without-thread-workspaces'], featured, today: '2026-11-12' })
    expect(tomorrow.featured?.rule).toBe('jj-without-revision-graph')
    expect(tomorrow.remember).toEqual({ day: '2026-11-12', rule: 'jj-without-revision-graph' })
  })

  it('never shows a dismissed suggestion, even in the full list', () => {
    const view = SuggestionsWindow.view({
      suggestions,
      dismissed: ['gh-without-pull-requests', 'plans-without-backlog'],
      featured: null,
      today: '2026-11-11',
    })
    expect([view.featured?.rule, ...rules(view.rest)]).toEqual(['jj-without-thread-workspaces', 'jj-without-revision-graph'])
  })

  it('formats the local day', () => {
    expect(SuggestionsWindow.localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})
