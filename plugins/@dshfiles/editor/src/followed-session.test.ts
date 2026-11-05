import { threadOnScreen } from '@dshfiles/workbench/thread-on-screen'
import { describe, expect, it } from 'vitest'
import { createFollowedSession } from './followed-session.js'

type DraftEntries = Readonly<Record<string, { readonly local: boolean; readonly preview?: string }>>

const observable = <T>(initial: T) => {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (next: T) => {
      value = next
      for (const listener of listeners) listener()
    },
  }
}

describe('editor followed session', () => {
  it('keeps the last thread while a New-thread draft is mounted, then shows the sent thread', () => {
    const mounted = observable<string | undefined>('session-a')
    const drafts = observable<DraftEntries>({})
    const followed = createFollowedSession(threadOnScreen({ mounted, sessionDrafts: () => ({ list: drafts }) }))
    const stop = followed.start()

    drafts.set({ 'session-draft': { local: true } })
    mounted.set('session-draft')
    expect(followed.get()).toBe('session-a')

    drafts.set({ 'session-draft': { local: false } })
    expect(followed.get()).toBe('session-draft')
    stop()
  })

  it('shows the session of an opened file link until another thread comes on screen, even while a draft is typed', () => {
    const mounted = observable<string | undefined>('session-b')
    const drafts = observable<DraftEntries>({ 'session-b': { local: true, preview: '' } })
    const followed = createFollowedSession(threadOnScreen({ mounted, sessionDrafts: () => ({ list: drafts }) }))
    const stop = followed.start()
    const changes: (string | undefined)[] = []
    followed.subscribe(() => changes.push(followed.get()))

    followed.show('session-a')
    drafts.set({ 'session-b': { local: true, preview: 'typing' } })
    expect(followed.get()).toBe('session-a')

    mounted.set('session-c')
    expect(followed.get()).toBe('session-c')
    expect(changes).toEqual(['session-a', 'session-c'])
    stop()
  })
})
