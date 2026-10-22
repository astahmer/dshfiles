import { describe, expect, it } from 'vitest'

import { BacklogActivityReferences } from './activity-thread-reference.js'
import type { BacklogEvent, BacklogLink } from './item.js'

const event = (kind: BacklogEvent['kind'], detail: string, threadId?: string): BacklogEvent => {
  const activity: BacklogEvent = { at: 1, actor: 'system', kind, detail }
  if (threadId === undefined) return activity
  return { ...activity, threadId }
}

const threadLink = (target: string): BacklogLink => ({ type: 'thread', target })

describe('backlog activity thread references', () => {
  it('prefers the event source thread over another linked thread', () => {
    const previous = event('linked', 'thread:session-old123')
    const current = event('moved', 'inbox → doing (mentioned in a thread)', 'session-new123')
    const events = [previous, current]

    expect(
      BacklogActivityReferences.threadIdOf({ event: current, eventIndex: 1, events, links: [threadLink('session-old123'), threadLink('session-new123')] }),
    ).toBe('session-new123')
  })

  it('recovers the source of older generic activity from the preceding link event', () => {
    const previous = event('linked', 'thread:session-abc123')
    const current = event('moved', 'inbox → doing (mentioned in a thread)')
    const events = [previous, current]

    expect(BacklogActivityReferences.threadIdOf({ event: current, eventIndex: 1, events, links: [threadLink('session-abc123')] })).toBe('session-abc123')
  })

  it('keeps older activity attached to the nearest source when multiple threads are linked', () => {
    const first = event('linked', 'thread:session-e2abd675-8d3a-4fd6-9f5e-cdb64df367ee')
    const moved = event('moved', 'inbox → doing (mentioned in a thread)')
    const second = event('linked', 'thread:session-0ea65643-8cd3-4e4c-80ea-372eb01f6620')
    const blocked = event('edited', 'attention: blocked (the thread failed: PI_AI_ERROR)')
    const events = [first, moved, second, blocked]
    const links = [threadLink('session-e2abd675-8d3a-4fd6-9f5e-cdb64df367ee'), threadLink('session-0ea65643-8cd3-4e4c-80ea-372eb01f6620')]

    expect(BacklogActivityReferences.threadIdOf({ event: moved, eventIndex: 1, events, links })).toBe('session-e2abd675-8d3a-4fd6-9f5e-cdb64df367ee')
    expect(BacklogActivityReferences.threadIdOf({ event: blocked, eventIndex: 3, events, links })).toBe('session-0ea65643-8cd3-4e4c-80ea-372eb01f6620')
  })

  it('does not guess when an older generic activity has multiple possible threads', () => {
    const current = event('moved', 'inbox → doing (mentioned in a thread)')
    const events = [current]

    expect(
      BacklogActivityReferences.threadIdOf({ event: current, eventIndex: 0, events, links: [threadLink('session-one123'), threadLink('session-two123')] }),
    ).toBeUndefined()
  })

  it('disambiguates same-title sessions without hiding either thread', () => {
    expect(BacklogActivityReferences.threadLabelOf({ title: 'Status filter', sessionId: 'session-abc123', duplicateTitle: true })).toBe(
      'Status filter · abc123',
    )
    expect(BacklogActivityReferences.threadLabelOf({ title: 'Unique thread', sessionId: 'session-def456', duplicateTitle: false })).toBe('Unique thread')
  })

  it('finds either the older generic phrase or a stored thread target in activity text', () => {
    expect(BacklogActivityReferences.threadReferenceRange('mentioned in a thread', 'session-abc123')).toEqual({ start: 13, end: 21, text: 'a thread' })
    expect(BacklogActivityReferences.threadReferenceRange('linked thread:session-abc123', 'session-abc123')).toEqual({
      start: 7,
      end: 28,
      text: 'thread:session-abc123',
    })
  })
})
