import { createActor } from '@dshfiles/plugin-ui/machine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Revision } from './api.js'
import { revisionLocateMachine } from './revision-locate-machine.js'

const revision = (commitId: string, overrides: Partial<Revision> = {}): Revision => ({
  commitId,
  parents: [],
  changeId: commitId,
  shortestChangeId: commitId,
  description: commitId,
  author: 'Person',
  authorTime: '2026-10-15T12:00:00Z',
  bookmarks: [],
  localBookmarks: [],
  remoteBookmarksText: '',
  tags: [],
  workspaces: [],
  workingCopy: false,
  mine: true,
  immutable: false,
  divergent: false,
  empty: false,
  conflict: false,
  evolved: false,
  changeOffset: 0,
  ...overrides,
})

const start = () => {
  const actor = createActor(revisionLocateMachine)
  actor.start()
  return actor
}

const reference = (value: string) => ({ value, kind: 'revision' as const, behavior: 'focus' as const })
const bookmarkReference = (value: string) => ({ value, kind: 'bookmark' as const, behavior: 'focus' as const })

afterEach(() => {
  vi.useRealTimers()
})

describe('revisionLocateMachine', () => {
  it('waits for a loaded repository before resolving or filtering a reference', () => {
    const actor = start()
    actor.send({ type: 'reference', reference: reference('abcdef123456') })
    expect(actor.getSnapshot().matches('resolving')).toBe(true)

    actor.send({ type: 'revisions', revisions: [], loaded: false })
    expect(actor.getSnapshot().matches('resolving')).toBe(true)
    expect(actor.getSnapshot().context.searchKey).toBeNull()

    actor.send({ type: 'revisions', revisions: [revision('abcdef123456', { changeId: 'llllllllllll' })], loaded: true })
    expect(actor.getSnapshot().matches('applying')).toBe(true)
    expect(actor.getSnapshot().context.target?.commitId).toBe('abcdef123456')
    expect(actor.getSnapshot().context.reference).toBeNull()
    actor.stop()
  })

  it('filters the graph once for a reference the loaded revisions do not hold', () => {
    const actor = start()
    actor.send({ type: 'reference', reference: bookmarkReference('missing-bookmark') })
    actor.send({ type: 'revisions', revisions: [], loaded: true })

    expect(actor.getSnapshot().context.searchKey).toBe('bookmark:missing-bookmark')
    actor.send({ type: 'revisions', revisions: [], loaded: true })
    expect(actor.getSnapshot().context.searchKey).toBe('bookmark:missing-bookmark')
    expect(actor.getSnapshot().matches('resolving')).toBe(true)

    actor.send({ type: 'revisions', revisions: [revision('abcdef123456', { bookmarks: ['missing-bookmark'] })], loaded: true })
    expect(actor.getSnapshot().context.target?.commitId).toBe('abcdef123456')
    actor.stop()
  })

  it('puts a target the graph hides behind its banner and reveals it into the scroll', () => {
    const actor = start()
    const target = revision('abcdef123456')

    actor.send({ type: 'locate', revision: target, visible: false })
    expect(actor.getSnapshot().matches('offscreen')).toBe(true)
    expect(actor.getSnapshot().context.target).toEqual(target)

    actor.send({ type: 'revealed', revision: target })
    expect(actor.getSnapshot().matches('locating')).toBe(true)

    actor.send({ type: 'located' })
    expect(actor.getSnapshot().matches('highlighted')).toBe(true)
    expect(actor.getSnapshot().context.highlighted).toBe('abcdef123456')
    actor.stop()
  })

  it('locates a visible target directly and clears the highlight after its flash', () => {
    vi.useFakeTimers()
    const actor = start()
    const target = revision('abcdef123456')

    actor.send({ type: 'locate', revision: target, visible: true })
    expect(actor.getSnapshot().matches('locating')).toBe(true)

    actor.send({ type: 'located' })
    expect(actor.getSnapshot().matches('highlighted')).toBe(true)

    vi.advanceTimersByTime(1799)
    expect(actor.getSnapshot().context.highlighted).toBe('abcdef123456')
    vi.advanceTimersByTime(1)
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.highlighted).toBeNull()
    actor.stop()
  })

  it('cancels a banner and resets the whole flow on a repository change', () => {
    const actor = start()
    actor.send({ type: 'locate', revision: revision('abcdef123456'), visible: false })
    actor.send({ type: 'cancel' })
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.target).toBeNull()

    actor.send({ type: 'revisions', revisions: [revision('abcdef123456')], loaded: true })
    actor.send({ type: 'reference', reference: reference('abcdef123456') })
    expect(actor.getSnapshot().matches('applying')).toBe(true)

    actor.send({ type: 'reset' })
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.target).toBeNull()
    expect(actor.getSnapshot().context.reference).toBeNull()
    actor.stop()
  })
})
