import { describe, expect, it } from 'vitest'
import { ScheduleModel, type Timing } from './schedule.js'

const at = (iso: string) => Date.parse(iso)

const plan = (timing: Timing, now: string) => {
  const planned = ScheduleModel.plan(timing, at(now))
  if (!planned.ok) throw new Error(planned.message)
  return planned.value
}

describe('ScheduleModel.plan', () => {
  it('commits the first target strictly after now and canonicalizes the rule', () => {
    const planned = plan({ kind: 'weekly', time: '09:00', timeZone: 'Europe/Paris', weekdays: [5, 1, 3] }, '2027-01-04T08:00:00Z')
    expect(planned.timing).toEqual({ kind: 'weekly', time: '09:00:00.000', timeZone: 'Europe/Paris', weekdays: [1, 3, 5] })
    // Monday 2027-01-04 09:00 CET is exactly now: the first target is Wednesday.
    expect(planned.nextRunAt).toBe('2027-01-06T08:00:00.000Z')
  })

  it('refuses an unknown time zone, a malformed cron expression and a sub-minute interval', () => {
    expect(ScheduleModel.plan({ kind: 'daily', time: '09:00', timeZone: 'Mars/Olympus' }, at('2027-01-01T00:00:00Z')).ok).toBe(false)
    expect(ScheduleModel.plan({ kind: 'cron', expression: '61 * * * *', timeZone: 'UTC' }, at('2027-01-01T00:00:00Z')).ok).toBe(false)
    expect(ScheduleModel.plan({ kind: 'every', everySeconds: 30 }, at('2027-01-01T00:00:00Z')).ok).toBe(false)
  })
})

describe('daylight saving time in Europe/Paris', () => {
  const daily = { kind: 'daily', time: '02:30', timeZone: 'Europe/Paris' } as const

  it('skips a local time that does not exist on the spring-forward day', () => {
    // 2027-03-28 02:00 CET jumps to 03:00 CEST: 02:30 never happens that day.
    expect(plan(daily, '2027-03-27T12:00:00Z').nextRunAt).toBe('2027-03-29T00:30:00.000Z')
  })

  it('runs a repeated local time once, at the earlier instant, on the fall-back day', () => {
    // 2027-10-31 03:00 CEST falls back to 02:00 CET: 02:30 happens at 00:30Z and again at 01:30Z.
    const first = plan(daily, '2027-10-30T12:00:00Z')
    expect(first.nextRunAt).toBe('2027-10-31T00:30:00.000Z')
    const decision = ScheduleModel.due(first.timing, first.nextRunAt, at('2027-10-31T00:30:01Z'))
    expect(decision).toEqual({ occurrenceAt: '2027-10-31T00:30:00.000Z', nextRunAt: '2027-11-01T01:30:00.000Z' })
  })

  it('applies the same rules to a cron rule', () => {
    const cron = { kind: 'cron', expression: '30 2 * * *', timeZone: 'Europe/Paris' } as const
    expect(plan(cron, '2027-03-27T12:00:00Z').nextRunAt).toBe('2027-03-29T00:30:00.000Z')
    expect(plan(cron, '2027-10-30T12:00:00Z').nextRunAt).toBe('2027-10-31T00:30:00.000Z')
  })
})

describe('missed runs', () => {
  it('waits while the committed target is in the future', () => {
    const planned = plan({ kind: 'every', everySeconds: 60 }, '2027-01-01T00:00:00Z')
    expect(ScheduleModel.due(planned.timing, planned.nextRunAt, at('2027-01-01T00:00:59Z'))).toBeUndefined()
  })

  it('runs a fixed-rate rule once for the latest missed occurrence after downtime', () => {
    const planned = plan({ kind: 'every', everySeconds: 60 }, '2027-01-01T00:00:00Z')
    expect(planned.nextRunAt).toBe('2027-01-01T00:01:00.000Z')
    // The Host was down for ten and a half minutes: ten targets passed, one run, for the latest of them.
    expect(ScheduleModel.due(planned.timing, planned.nextRunAt, at('2027-01-01T00:11:30Z'))).toEqual({
      occurrenceAt: '2027-01-01T00:11:00.000Z',
      nextRunAt: '2027-01-01T00:12:00.000Z',
    })
  })

  it('runs a daily rule once for the latest missed day', () => {
    const daily = plan({ kind: 'daily', time: '09:00', timeZone: 'Europe/Paris' }, '2027-01-09T12:00:00Z')
    expect(daily.nextRunAt).toBe('2027-01-10T08:00:00.000Z')
    expect(ScheduleModel.due(daily.timing, daily.nextRunAt, at('2027-01-13T10:00:00Z'))).toEqual({
      occurrenceAt: '2027-01-13T08:00:00.000Z',
      nextRunAt: '2027-01-14T08:00:00.000Z',
    })
  })
})

it('describes each rule in one line', () => {
  expect(ScheduleModel.describe({ kind: 'cron', expression: '0 9 * * 1-5', timeZone: 'UTC' })).toBe('cron 0 9 * * 1-5 (UTC)')
  expect(ScheduleModel.describe({ kind: 'weekly', time: '09:00:00.000', timeZone: 'UTC', weekdays: [1, 5] })).toBe('weekly on Mon, Fri at 09:00 (UTC)')
  expect(ScheduleModel.describe({ kind: 'every', everySeconds: 60 })).toBe('every 1 min')
})
