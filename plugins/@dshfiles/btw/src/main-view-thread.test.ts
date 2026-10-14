import { describe, expect, it } from 'vitest'
import { mainViewThreadId } from './main-view-thread.js'

describe('main view thread', () => {
  it('picks the thread the main view retains, skipping side panes and blank drafts', () => {
    expect(
      mainViewThreadId([
        { id: 'side', blank: false, retainedBy: { mainView: 0 } },
        { id: 'draft', blank: true, retainedBy: { mainView: 1 } },
        { id: 'shown', blank: false, retainedBy: { mainView: 1 } },
      ]),
    ).toBe('shown')
  })

  it('has no target on a panel or the New thread screen', () => {
    expect(mainViewThreadId([{ id: 'idle', blank: false, retainedBy: {} }])).toBeUndefined()
  })
})
