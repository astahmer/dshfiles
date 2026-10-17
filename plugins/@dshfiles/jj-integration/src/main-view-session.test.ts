import { describe, expect, it } from 'vitest'
import { mainViewSessionId, mainViewSessionVisitId } from './main-view-session.js'

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

  it('gives each blank Session its own visit even before either gets a turn', () => {
    const firstSessionVisit = mainViewSessionVisitId('session-first')
    const secondSessionVisit = mainViewSessionVisitId('session-second')

    expect(firstSessionVisit).not.toBe(secondSessionVisit)
    expect(firstSessionVisit).toBe('new-thread:session-first')
  })

  it('does not mistake the previous conversation for a new-thread composer', () => {
    expect(mainViewSessionId({ ids: ['previous', 'hidden'], byId: sessions.byId })).toBeUndefined()
  })

  it('returns undefined when no blank Session is retained in the main view', () => {
    expect(mainViewSessionId({ ids: ['hidden'], byId: sessions.byId })).toBeUndefined()
  })
})
