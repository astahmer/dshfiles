import { describe, expect, it } from 'vitest'
import { mainViewSessionId } from './main-view-session.js'

const sessions = {
  ids: ['previous', 'new', 'hidden'],
  byId: {
    previous: { blank: false, retainedBy: { mainView: 1 } },
    new: { blank: true, retainedBy: { mainView: 1 } },
    hidden: { blank: true, retainedBy: { mainView: 0 } },
  },
}

describe('mainViewSessionId', () => {
  it('prefers the blank New-thread Session over an older retained conversation', () => {
    expect(mainViewSessionId(sessions)).toBe('new')
  })

  it('ignores blank Sessions that are not retained in the main view', () => {
    expect(mainViewSessionId({ ids: ['previous', 'hidden'], byId: sessions.byId })).toBe('previous')
  })

  it('returns undefined when no Session is retained in the main view', () => {
    expect(mainViewSessionId({ ids: ['hidden'], byId: sessions.byId })).toBeUndefined()
  })
})
