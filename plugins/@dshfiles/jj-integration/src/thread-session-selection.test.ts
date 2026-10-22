import { describe, expect, it } from 'vitest'
import { ThreadSessionSelection, type ThreadSessionReference } from './thread-session-selection.js'

const blank = (): ThreadSessionReference => ({ blank: true })
const conversation = (): ThreadSessionReference => ({ blank: false })

const lookup = (entries: Readonly<Record<string, ThreadSessionReference>>): ReadonlyMap<string, ThreadSessionReference> => new Map(Object.entries(entries))

describe('main session of a thread workspace', () => {
  it('prefers the newest session with a real conversation over a newer blank New-thread slot', () => {
    const sessionById = lookup({ 'session-blank': blank(), 'session-real': conversation(), 'session-older': conversation() })
    expect(ThreadSessionSelection.mainSessionOf({ sessionIds: ['session-blank', 'session-real', 'session-older'], sessionById })).toBe(
      sessionById.get('session-real'),
    )
  })

  it('falls back to the newest blank slot when every session is blank', () => {
    const sessionById = lookup({ 'session-newest': blank(), 'session-older': blank() })
    expect(ThreadSessionSelection.mainSessionOf({ sessionIds: ['session-newest', 'session-older'], sessionById })).toBe(sessionById.get('session-newest'))
  })

  it('skips ids the client cannot read instead of opening an empty conversation', () => {
    const sessionById = lookup({ 'session-real': conversation() })
    expect(ThreadSessionSelection.mainSessionOf({ sessionIds: ['session-unknown', 'session-real'], sessionById })).toBe(sessionById.get('session-real'))
    expect(ThreadSessionSelection.mainSessionOf({ sessionIds: ['session-unknown'], sessionById })).toBeUndefined()
  })
})

describe('sessions listed under a thread row', () => {
  it('keeps real conversations in registry order and drops blank placeholders', () => {
    const sessionById = lookup({ 'session-blank': blank(), 'session-newer': conversation(), 'session-older': conversation() })
    expect(ThreadSessionSelection.visibleSessionIdsOf({ sessionIds: ['session-blank', 'session-newer', 'session-older'], sessionById })).toEqual([
      'session-newer',
      'session-older',
    ])
  })

  it('keeps an unreadable id so the row still names the session it could not open', () => {
    const sessionById = lookup({ 'session-blank': blank() })
    expect(ThreadSessionSelection.visibleSessionIdsOf({ sessionIds: ['session-blank', 'session-unreadable'], sessionById })).toEqual(['session-unreadable'])
  })
})

describe('unused thread rows', () => {
  it('hides a registration with no session and no work', () => {
    expect(ThreadSessionSelection.isUnusedThread({ sessionIds: [], pendingRevisions: 0, sessionById: lookup({}) })).toBe(true)
  })

  it('hides a workspace whose only sessions are blank placeholders', () => {
    expect(
      ThreadSessionSelection.isUnusedThread({ sessionIds: ['session-blank'], pendingRevisions: 0, sessionById: lookup({ 'session-blank': blank() }) }),
    ).toBe(true)
  })

  it('keeps a workspace that holds pending revisions, even without sessions', () => {
    expect(ThreadSessionSelection.isUnusedThread({ sessionIds: [], pendingRevisions: 1, sessionById: lookup({}) })).toBe(false)
    expect(
      ThreadSessionSelection.isUnusedThread({ sessionIds: ['session-blank'], pendingRevisions: 1, sessionById: lookup({ 'session-blank': blank() }) }),
    ).toBe(false)
  })

  it('keeps a workspace with a real conversation', () => {
    expect(
      ThreadSessionSelection.isUnusedThread({ sessionIds: ['session-real'], pendingRevisions: 0, sessionById: lookup({ 'session-real': conversation() }) }),
    ).toBe(false)
  })

  it('keeps a row whose session could not be read, rather than hiding an unknown workspace', () => {
    expect(ThreadSessionSelection.isUnusedThread({ sessionIds: ['session-unreadable'], pendingRevisions: 0, sessionById: lookup({}) })).toBe(false)
  })
})
