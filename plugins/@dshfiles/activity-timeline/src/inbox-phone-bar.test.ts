import { afterEach, describe, expect, it, vi } from 'vitest'
import { InboxPhoneActionsStore } from './inbox-phone-bar.js'

const actions = (label: string) => ({ actions: [{ id: 'alerts', label, onSelect: () => undefined }], moreLabel: 'More' })

describe('Inbox phone bar store (round five C4)', () => {
  afterEach(() => {
    InboxPhoneActionsStore.clear('a')
    InboxPhoneActionsStore.clear('b')
  })

  it('shows the most recent page that published, and nothing once every page unmounted', () => {
    const listener = vi.fn()
    const unsubscribe = InboxPhoneActionsStore.subscribe(listener)
    InboxPhoneActionsStore.publish('a', actions('A'))
    InboxPhoneActionsStore.publish('b', actions('B'))
    expect(InboxPhoneActionsStore.read()?.actions[0]?.label).toBe('B')
    // A re-render of the older page brings it to the front: it is the one the user is acting in.
    InboxPhoneActionsStore.publish('a', actions('A2'))
    expect(InboxPhoneActionsStore.read()?.actions[0]?.label).toBe('A2')
    InboxPhoneActionsStore.clear('a')
    expect(InboxPhoneActionsStore.read()?.actions[0]?.label).toBe('B')
    InboxPhoneActionsStore.clear('b')
    expect(InboxPhoneActionsStore.read()).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(5)
    unsubscribe()
  })
})
