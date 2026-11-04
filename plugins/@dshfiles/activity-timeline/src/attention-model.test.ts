import { describe, expect, it } from 'vitest'
import type { AttentionItem, AttentionPublish } from './attention-api.js'
import { AttentionModel, CLOSED_RETENTION_MS } from './attention-model.js'

const question = (overrides: Partial<AttentionPublish> = {}): AttentionPublish => ({
  source: 'agent-questions.child-question',
  dedupeKey: 'question-1',
  subject: { kind: 'session', id: 'session-parent' },
  reason: 'A subagent asks: deploy now?',
  severity: 'blocking',
  verbs: ['Answer', 'Open', 'Done', 'Snooze'],
  choices: [
    { id: 'yes', label: 'Deploy', recommended: true },
    { id: 'no', label: 'Wait' },
  ],
  ...overrides,
})

const created = (input: AttentionPublish = question(), now = 1_000): AttentionItem => AttentionModel.publish(undefined, input, now).item

const okItem = (transition: ReturnType<typeof AttentionModel.done>): AttentionItem => {
  if (!transition.ok) throw new Error(`expected a transition, got ${transition.refusal}`)
  return transition.item
}

describe('attention model', () => {
  it('dedupes a repeat with the same key and state into one unchanged item', () => {
    const first = created()
    const repeat = AttentionModel.publish(first, question(), 2_000)
    expect(repeat.changed).toBe(false)
    expect(repeat.item).toBe(first)
    expect(first.id).toBe(AttentionModel.itemIdOf('agent-questions.child-question', 'question-1'))
    expect(AttentionModel.itemIdOf('other.source', 'question-1')).not.toBe(first.id)
  })

  it('merges a changed repeat in place, keeping identity and creation time', () => {
    const first = created()
    const merged = AttentionModel.publish(first, question({ severity: 'failed', reason: 'The question expired' }), 2_000)
    expect(merged.changed).toBe(true)
    expect(merged.item).toMatchObject({ id: first.id, createdAt: 1_000, openedAt: 1_000, updatedAt: 2_000, severity: 'failed', occurrences: 1 })
  })

  it('resolves once and reopens as a new occurrence when the source publishes again', () => {
    const first = created()
    const resolved = AttentionModel.resolve(first, 2_000)
    expect(resolved).toMatchObject({ changed: true, item: { resolvedAt: 2_000 } })
    expect(AttentionModel.resolve(resolved.item, 3_000).changed).toBe(false)
    expect(AttentionModel.viewOf(resolved.item, new Set(), 2_500)).toBe('closed')
    const again = AttentionModel.publish(resolved.item, question(), 4_000)
    expect(again.item).toMatchObject({ resolvedAt: null, openedAt: 4_000, occurrences: 2 })
    expect(AttentionModel.viewOf(again.item, new Set(), 4_000)).toBe('needs-you')
  })

  it('keeps a snooze-until-change through unchanged repeats and lifts it on a change', () => {
    const snoozed = okItem(AttentionModel.snooze(created(), { untilChange: true }, 2_000))
    expect(AttentionModel.viewOf(snoozed, new Set(), 10_000_000)).toBe('snoozed')
    const repeat = AttentionModel.publish(snoozed, question(), 3_000)
    expect(repeat.changed).toBe(false)
    expect(AttentionModel.viewOf(repeat.item, new Set(), 3_000)).toBe('snoozed')
    const changed = AttentionModel.publish(snoozed, question({ reason: 'A subagent asks again: deploy now?' }), 4_000)
    expect(changed.item.snoozeUntilChange).toBe(false)
    expect(AttentionModel.viewOf(changed.item, new Set(), 4_000)).toBe('needs-you')
  })

  it('wakes a timed snooze at its time and refuses one in the past', () => {
    const item = created()
    const snoozed = okItem(AttentionModel.snooze(item, { until: 5_000 }, 2_000))
    expect(AttentionModel.viewOf(snoozed, new Set(), 4_999)).toBe('snoozed')
    expect(AttentionModel.viewOf(snoozed, new Set(), 5_000)).toBe('needs-you')
    expect(AttentionModel.snooze(item, { until: 1_500 }, 2_000)).toEqual({ ok: false, refusal: 'snooze-in-past' })
    expect(AttentionModel.snooze(item, {}, 2_000)).toEqual({ ok: false, refusal: 'snooze-target-missing' })
  })

  it('reopens a done item and a snoozed item, and refuses to reopen a resolved one', () => {
    const done = okItem(AttentionModel.done(created(), 2_000))
    expect(AttentionModel.viewOf(done, new Set(), 2_000)).toBe('closed')
    // An unchanged repeat keeps Done; a changed one reopens it.
    expect(AttentionModel.publish(done, question(), 2_500).changed).toBe(false)
    const reopened = okItem(AttentionModel.reopen(done, 3_000))
    expect(reopened.doneAt).toBeNull()
    expect(AttentionModel.viewOf(reopened, new Set(), 3_000)).toBe('needs-you')

    const snoozed = okItem(AttentionModel.snooze(created(), { until: 9_000 }, 2_000))
    expect(AttentionModel.viewOf(okItem(AttentionModel.reopen(snoozed, 3_000)), new Set(), 3_000)).toBe('needs-you')

    const resolved = AttentionModel.resolve(created(), 2_000).item
    expect(AttentionModel.reopen(resolved, 3_000)).toEqual({ ok: false, refusal: 'resolved' })
    expect(AttentionModel.done(resolved, 3_000)).toEqual({ ok: false, refusal: 'resolved' })
  })

  it('splits needs-you from other, hides muted sources and never lists info', () => {
    const blocking = created()
    const failed = created(question({ dedupeKey: 'q-2', severity: 'failed' }), 2_000)
    const ready = created(question({ source: 'thread-sidebar.finished-turn', dedupeKey: 's-1', severity: 'ready' }), 3_000)
    const info = created(question({ dedupeKey: 'q-3', severity: 'info' }), 4_000)
    const items = [ready, failed, blocking, info]
    const needsYou = AttentionModel.listView({ items, mutedSources: new Set(), view: 'needs-you', limit: 10, now: 5_000 })
    expect(needsYou.map(item => item.id)).toEqual([blocking.id, failed.id])
    expect(AttentionModel.listView({ items, mutedSources: new Set(), view: 'other', limit: 10, now: 5_000 })).toEqual([ready])
    expect(AttentionModel.countsOf(items, new Set(), 5_000)).toEqual({ needsYou: 2, blocking: 1, other: 1, snoozed: 0, closed: 0, muted: 0 })
    const muted = new Set(['agent-questions.child-question'])
    expect(AttentionModel.countsOf(items, muted, 5_000)).toEqual({ needsYou: 0, blocking: 0, other: 1, snoozed: 0, closed: 0, muted: 2 })
  })

  it('prunes closed items after retention and bounds the store, closed items first', () => {
    const open = created(question({ dedupeKey: 'open' }), 1_000)
    const oldDone = okItem(AttentionModel.done(created(question({ dedupeKey: 'old' }), 1_000), 1_000))
    const recentDone = okItem(AttentionModel.done(created(question({ dedupeKey: 'recent' }), 1_000), CLOSED_RETENTION_MS))
    const now = CLOSED_RETENTION_MS + 2_000
    expect(AttentionModel.pruneIds([open, oldDone, recentDone], now)).toEqual([oldDone.id])
    expect(AttentionModel.pruneIds([open, recentDone], now, 1)).toEqual([recentDone.id])
  })
})
