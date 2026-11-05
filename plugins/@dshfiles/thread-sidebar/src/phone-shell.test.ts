import { describe, expect, it } from 'vitest'
import { Destinations } from './destinations.js'
import { PhoneTopBarModel, SETTINGS_PANEL_ID } from './phone-shell.js'

const destinations = Destinations.resolve([
  { id: 'attention-inbox', label: 'Inbox', order: 1 },
  { id: 'jj-integration', label: 'JJ Integration: Thread integration', order: 2 },
  { id: 'pulls-review', label: 'pulls.review: Reviews', order: 3 },
  { id: 'dshfiles-memory-panel', label: 'Memory: Browser', order: 4 },
  { id: 'ai-accounts', label: 'AI Accounts: Accounts', order: 5 },
])
const find = (id: string) => {
  const found = destinations.find(destination => destination.id === id)
  if (found === undefined) throw new Error(`no ${id}`)
  return found
}
const base = { listOpen: false, moreOpen: false, destination: find('threads'), destinations, activePanelId: null, selectedThreadId: null } as const

describe('PhoneTopBarModel', () => {
  it('names a thread on the stage and goes back to Threads, offering its panels', () => {
    expect(PhoneTopBarModel.resolve({ ...base, selectedThreadId: 'session-1', stageTitle: 'Fix the login race' })).toEqual({
      title: 'Fix the login race',
      back: { to: 'threads', label: 'Threads' },
      thread: true,
    })
  })

  it('returns a thread opened from the Inbox to the Inbox', () => {
    expect(PhoneTopBarModel.resolve({ ...base, selectedThreadId: 'session-1', stageTitle: 'Answer me', origin: { panelId: 'attention-inbox' } })).toEqual({
      title: 'Answer me',
      back: { to: 'page', panelId: 'attention-inbox', label: 'Inbox' },
      thread: true,
    })
    expect(PhoneTopBarModel.resolve({ ...base, selectedThreadId: 'session-1', origin: { panelId: 'pulls-review' } }).back).toEqual({
      to: 'page',
      panelId: 'pulls-review',
      label: 'Review',
    })
  })

  it('calls a draft New thread and offers no panels until it is a thread', () => {
    expect(PhoneTopBarModel.resolve(base)).toEqual({ title: 'New thread', back: { to: 'threads', label: 'Threads' }, thread: false })
    expect(PhoneTopBarModel.resolve({ ...base, selectedThreadId: 'session-1', stageTitle: '  ' }).title).toBe('Thread')
  })

  it('returns from a page to its destination list, named after the section', () => {
    expect(PhoneTopBarModel.resolve({ ...base, activePanelId: 'pulls-review' })).toEqual({
      title: 'Review',
      back: { to: 'land', label: 'Land' },
      thread: false,
    })
  })

  it('treats the Inbox page as the Inbox tab root: its name, no Back', () => {
    expect(PhoneTopBarModel.resolve({ ...base, activePanelId: 'attention-inbox' })).toEqual({ title: 'Inbox', back: null, thread: false })
  })

  it('returns from a single-page destination and from Settings to More', () => {
    expect(PhoneTopBarModel.resolve({ ...base, activePanelId: 'dshfiles-memory-panel' }).back).toEqual({ to: 'more', label: 'More' })
    expect(PhoneTopBarModel.resolve({ ...base, activePanelId: SETTINGS_PANEL_ID })).toEqual({
      title: 'Settings',
      back: { to: 'more', label: 'More' },
      thread: false,
    })
    expect(PhoneTopBarModel.resolve({ ...base, activePanelId: 'ai-accounts' })).toEqual({
      title: 'AI accounts',
      back: { to: 'more', label: 'More' },
      thread: false,
    })
  })

  it('shows the open list: tab roots have no Back, a destination opened from More goes back to More', () => {
    expect(PhoneTopBarModel.resolve({ ...base, listOpen: true })).toEqual({ title: 'Threads', back: null, thread: false })
    expect(PhoneTopBarModel.resolve({ ...base, listOpen: true, moreOpen: true })).toEqual({ title: 'More', back: null, thread: false })
    expect(PhoneTopBarModel.resolve({ ...base, listOpen: true, destination: find('land') })).toEqual({
      title: 'Land',
      back: { to: 'more', label: 'More' },
      thread: false,
    })
  })
})
