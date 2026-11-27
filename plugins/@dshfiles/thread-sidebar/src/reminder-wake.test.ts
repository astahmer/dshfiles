import { ScheduleId } from '@deepseek-ai/dsh-schedule'
import { describe, expect, it } from 'vitest'
import { ReminderWakeModel, type ScannedReminder } from './reminder-wake.js'

const NOW = 1_000_000_000
const AHEAD = 60_000

const reminder = (overrides: Partial<ScannedReminder> & Pick<ScannedReminder, 'sessionId' | 'scheduledAt'>): ScannedReminder => ({
  id: ScheduleId(`task-${overrides.sessionId}`),
  active: true,
  ...overrides,
})

const plan = (input: { readonly reminders: readonly ScannedReminder[]; readonly settled?: readonly string[]; readonly archived?: readonly string[] }) =>
  ReminderWakeModel.plan({
    reminders: input.reminders,
    now: NOW,
    aheadMs: AHEAD,
    settledSessionIds: new Set(input.settled ?? []),
    archivedSessionIds: new Set(input.archived ?? []),
  })

describe('ReminderWakeModel.plan', () => {
  it('lifts a settled thread only once its reminder is within the wake window', () => {
    expect(plan({ reminders: [reminder({ sessionId: 'a', scheduledAt: NOW + 2 * AHEAD })], settled: ['a'] }).unsettle).toEqual([])
    expect(plan({ reminders: [reminder({ sessionId: 'a', scheduledAt: NOW + AHEAD })], settled: ['a'] }).unsettle).toEqual(['a'])
    expect(plan({ reminders: [reminder({ sessionId: 'a', scheduledAt: NOW - 1 })], settled: ['a'] }).unsettle).toEqual(['a'])
  })

  it('restores an archived thread and runs its missed reminder when the occurrence already passed', () => {
    const overdue = reminder({ sessionId: 'a', scheduledAt: NOW - 5_000 })
    expect(plan({ reminders: [overdue], archived: ['a'] })).toEqual({ unsettle: [], restore: ['a'], deliver: [overdue] })
  })

  it('leaves an acknowledged reminder alone: its next occurrence is still ahead', () => {
    expect(plan({ reminders: [reminder({ sessionId: 'a', scheduledAt: NOW + 2 * AHEAD })], archived: ['a'] })).toEqual({
      unsettle: [],
      restore: [],
      deliver: [],
    })
  })

  it('wakes nothing for paused, ended or non-finite reminders, and holds no status for an awake thread', () => {
    expect(
      plan({
        reminders: [
          reminder({ sessionId: 'paused', scheduledAt: NOW, active: false }),
          reminder({ sessionId: 'broken', scheduledAt: Number.NaN }),
          reminder({ sessionId: 'awake', scheduledAt: NOW - 1 }),
        ],
        settled: ['paused', 'broken'],
        archived: ['paused', 'broken'],
      }),
    ).toEqual({ unsettle: [], restore: [], deliver: [] })
  })

  it('wakes a thread that is both settled and archived once, and runs its reminder only once', () => {
    const overdue = reminder({ sessionId: 'both', scheduledAt: NOW - 1 })
    expect(plan({ reminders: [overdue, overdue], settled: ['both'], archived: ['both'] })).toEqual({
      unsettle: ['both'],
      restore: ['both'],
      deliver: [overdue, overdue],
    })
  })
})

describe('ReminderWakeModel.hasPendingReminder', () => {
  it('holds one thread only for its own active reminders', () => {
    const reminders = [reminder({ sessionId: 'a', scheduledAt: NOW }), reminder({ sessionId: 'b', scheduledAt: NOW, active: false })]
    expect(ReminderWakeModel.hasPendingReminder({ reminders, sessionId: 'a' })).toBe(true)
    expect(ReminderWakeModel.hasPendingReminder({ reminders, sessionId: 'b' })).toBe(false)
    expect(ReminderWakeModel.hasPendingReminder({ reminders, sessionId: 'c' })).toBe(false)
  })
})
