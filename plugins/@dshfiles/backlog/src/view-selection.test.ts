import { describe, expect, it } from 'vitest'

import { setBacklogViewSelection, type BacklogViewSelection } from './view-selection.js'

const emptySelection: BacklogViewSelection = { feed: null, inbox: null, items: null, board: null, projects: null }

describe('backlog view selection', () => {
  it('keeps each view’s open item independent', () => {
    const backlog = setBacklogViewSelection(emptySelection, 'items', 151)
    const inbox = backlog.inbox

    expect(backlog.items).toBe(151)
    expect(inbox).toBeNull()
    expect(setBacklogViewSelection(backlog, 'inbox', 42)).toMatchObject({ items: 151, inbox: 42 })
  })

  it('clears only the active view selection', () => {
    const selections = setBacklogViewSelection(setBacklogViewSelection(emptySelection, 'items', 151), 'inbox', 42)

    expect(setBacklogViewSelection(selections, 'inbox', null)).toMatchObject({ items: 151, inbox: null })
  })
})
