import { describe, expect, it } from 'vitest'

import { BacklogItems } from './item.js'

describe('thread link extraction', () => {
  it('links a session id mentioned in the text', () => {
    expect(BacklogItems.triage('Seen in session-9f8e7d6c after the crash').links).toEqual([
      { type: 'thread', target: 'session-9f8e7d6c', provenance: 'extracted' },
    ])
  })

  it('does not link a package name that only looks like a thread reference', () => {
    const triaged = BacklogItems.triage('fork the whole package as `chat` and `session-controller` (Host side included)')

    expect(triaged.links).toEqual([])
  })

  it('does not link a prose word after "session-"', () => {
    expect(BacklogItems.triage('the session-history panel and its session-search box').links).toEqual([])
  })

  it('accepts a bare or prefixed session id and rejects a word', () => {
    expect(BacklogItems.isSessionId('9e185ebf-1a7e-488f-b8a4-b9c877a4d724')).toBe(true)
    expect(BacklogItems.isSessionId('session-9e185ebf')).toBe(true)
    expect(BacklogItems.isSessionId('session-controller')).toBe(false)
  })
})

describe('revision backlinks', () => {
  const revision = (target: string) => ({ type: 'revision' as const, target })

  it('reaches a revision through a prefix of its change or commit id, either way round', () => {
    expect(BacklogItems.linkReaches(revision('mounnnvz'), revision('mounnnvzuzupkxql'))).toBe(true)
    expect(BacklogItems.linkReaches(revision('3f32cd261a80ffee'), revision('3f32cd26'))).toBe(true)
  })

  it('does not match a bookmark, a mixed alphabet, a too-short prefix or another revision', () => {
    expect(BacklogItems.linkReaches(revision('main'), revision('mainline'))).toBe(false)
    expect(BacklogItems.linkReaches(revision('mou'), revision('mounnnvz'))).toBe(false)
    expect(BacklogItems.linkReaches(revision('3f32'), revision('3f3zz'))).toBe(false)
    expect(BacklogItems.linkReaches(revision('mounnnvz'), revision('mmotoyuv'))).toBe(false)
  })

  it('keeps exact matching for every other link type', () => {
    expect(BacklogItems.linkReaches({ type: 'thread', target: 'session-abcdef12' }, { type: 'thread', target: 'session-abcdef' })).toBe(false)
    expect(BacklogItems.linkReaches({ type: 'branch', target: 'main' }, { type: 'branch', target: 'main' })).toBe(true)
  })
})
