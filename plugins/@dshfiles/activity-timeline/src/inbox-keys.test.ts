import { describe, expect, it } from 'vitest'
import type { AttentionItem } from './attention-api.js'
import { HeldOrder } from './held-order.js'
import { InboxKeys } from './inbox-keys.js'

const item = (input: Partial<AttentionItem> & Pick<AttentionItem, 'id'>): AttentionItem => ({
  source: 'test.source',
  dedupeKey: input.id,
  subject: { kind: 'session', id: `session-${input.id}` },
  reason: input.id,
  detail: null,
  severity: 'blocking',
  verbs: ['Done', 'Snooze'],
  choices: [],
  fingerprint: 'f',
  createdAt: 1,
  openedAt: 1,
  updatedAt: 1,
  occurrences: 1,
  resolvedAt: null,
  doneAt: null,
  snoozedUntil: null,
  snoozeUntilChange: false,
  ...input,
})

describe('InboxKeys', () => {
  it('answers only a recommended choice on Enter and never runs Land', () => {
    const question = item({
      id: 'q',
      verbs: ['Answer', 'Done'],
      choices: [
        { id: 'a', label: 'Yes', recommended: true },
        { id: 'b', label: 'No' },
      ],
    })
    expect(InboxKeys.primaryOf(question)).toEqual({ kind: 'answer', choiceId: 'a', label: 'Yes' })
    expect(InboxKeys.primaryOf(item({ id: 'u', verbs: ['Answer'], choices: [{ id: 'a', label: 'Yes' }] }))).toEqual({ kind: 'open' })
    expect(InboxKeys.primaryOf(item({ id: 'l', verbs: ['Land', 'Done'] }))).toEqual({ kind: 'land' })
    expect(InboxKeys.primaryOf(item({ id: 'r', verbs: ['Retry', 'Done'] }))).toEqual({ kind: 'verb', verb: 'Retry' })
    expect(InboxKeys.choiceAt(question, 2)).toBe('b')
    expect(InboxKeys.choiceAt(question, 3)).toBeUndefined()
  })

  it('steps, extends and hands the highlight to the neighbour of a removed row', () => {
    const ids = ['a', 'b', 'c', 'd']
    expect(InboxKeys.step(ids, null, 1)).toBe('a')
    expect(InboxKeys.step(ids, 'd', 1)).toBe('d')
    expect(InboxKeys.step(ids, 'c', -1)).toBe('b')
    expect(InboxKeys.extend(ids, 'b', 'd')).toEqual(['b', 'c', 'd'])
    expect(InboxKeys.afterRemoval(ids, ['a', 'c', 'd'], 'b')).toBe('c')
    expect(InboxKeys.afterRemoval(ids, ['a', 'b', 'c'], 'd')).toBe('c')
  })
})

describe('HeldOrder', () => {
  it('keeps held rows in place, drops rows that left and counts what waits', () => {
    const items = ['c', 'a', 'x'].map(id => ({ id }))
    expect(HeldOrder.hold(items, ['a', 'b', 'c']).map(entry => entry.id)).toEqual(['a', 'c'])
    expect(HeldOrder.pending(['c', 'a', 'x'], ['a', 'b', 'c'])).toBe(3)
    expect(HeldOrder.pending(['a', 'c'], ['a', 'b', 'c'])).toBe(0)
    expect(HeldOrder.hold(items, null)).toBe(items)
  })
})
