import { describe, expect, it } from 'vitest'
import { threadOnScreen, type SessionDraftsOwner } from './thread-on-screen.js'

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

const recorder = (source: { readonly getSnapshot: () => string | undefined; readonly subscribe: (listener: () => void) => () => void }) => {
  const seen: (string | undefined)[] = []
  const stop = source.subscribe(() => seen.push(source.getSnapshot()))
  return { seen, stop }
}

describe('thread on screen', () => {
  it('reads a New-thread draft as no thread until the Host created it, then as that thread', () => {
    const mounted = observable<string | undefined>('session-a')
    const drafts = observable<DraftEntries>({})
    const onScreen = threadOnScreen({ mounted, sessionDrafts: () => ({ list: drafts }) })
    const { seen } = recorder(onScreen)

    drafts.set({ 'session-draft': { local: true, preview: '' } })
    mounted.set('session-draft')
    expect(onScreen.getSnapshot()).toBeUndefined()

    drafts.set({ 'session-draft': { local: true, preview: 'hel' } })
    drafts.set({ 'session-draft': { local: true, preview: 'hello' } })
    drafts.set({ 'session-draft': { local: false, preview: 'hello' } })
    expect(onScreen.getSnapshot()).toBe('session-draft')
    expect(seen).toEqual([undefined, 'session-draft'])
  })

  it('follows the mounted session when no drafts owner is loaded, and attaches one that starts later', () => {
    const mounted = observable<string | undefined>('session-a')
    const drafts = observable<DraftEntries>({})
    let draftsOwner: SessionDraftsOwner | undefined
    const onScreen = threadOnScreen({ mounted, sessionDrafts: () => draftsOwner })
    const { seen } = recorder(onScreen)

    mounted.set('session-b')
    expect(onScreen.getSnapshot()).toBe('session-b')

    draftsOwner = { list: drafts }
    drafts.set({ 'session-draft': { local: true } })
    mounted.set('session-draft')
    drafts.set({ 'session-draft': { local: false } })
    expect(seen).toEqual(['session-b', undefined, 'session-draft'])
  })
})
