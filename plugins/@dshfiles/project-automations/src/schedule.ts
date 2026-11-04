import {
  createCronScheduleRecord,
  createDailyScheduleRecord,
  createEveryScheduleRecord,
  createWeeklyScheduleRecord,
  ScheduleId,
  ScheduleInputError,
  resolveRecurringOccurrence,
  type RecurringScheduleRecord,
} from '@deepseek-ai/dsh-schedule'

/**
 * When an automation's schedule fires. The calendar arithmetic (IANA zones, DST gaps and overlaps, latest-only
 * catch-up) is DSH's own Schedule domain, so a project automation and a session reminder agree on every instant.
 */
export type Timing =
  | { readonly kind: 'cron'; readonly expression: string; readonly timeZone: string }
  | { readonly kind: 'daily'; readonly time: string; readonly timeZone: string }
  | { readonly kind: 'weekly'; readonly time: string; readonly timeZone: string; readonly weekdays: readonly number[] }
  | { readonly kind: 'every'; readonly everySeconds: number }

export type TimingResult<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly message: string }

/** The record fields the Schedule domain reads; the title and prompt never leave this module. */
const PLACEHOLDER = 'project automation'
const ID = ScheduleId('project-automation')

const failure = (cause: unknown): TimingResult<never> => {
  if (cause instanceof ScheduleInputError) return { ok: false, message: cause.message }
  if (cause instanceof RangeError) return { ok: false, message: cause.message }
  throw cause
}

/** The Schedule domain reads `HH:mm:ss`; a person (or an agent) writes `09:00`. */
const withSeconds = (time: string): string => (/^\d{2}:\d{2}$/u.test(time.trim()) ? `${time.trim()}:00` : time.trim())

const recordOf = (timing: Timing, now: number): RecurringScheduleRecord => {
  switch (timing.kind) {
    case 'cron':
      return createCronScheduleRecord(ID, PLACEHOLDER, { expression: timing.expression, time_zone: timing.timeZone }, now, PLACEHOLDER)
    case 'daily':
      return createDailyScheduleRecord(ID, PLACEHOLDER, { time: withSeconds(timing.time), time_zone: timing.timeZone }, now, PLACEHOLDER)
    case 'weekly':
      return createWeeklyScheduleRecord(
        ID,
        PLACEHOLDER,
        { time: withSeconds(timing.time), time_zone: timing.timeZone, weekdays: [...timing.weekdays] },
        now,
        PLACEHOLDER,
      )
    case 'every':
      return createEveryScheduleRecord(ID, PLACEHOLDER, timing.everySeconds, now, PLACEHOLDER)
  }
}

const timingOf = (record: RecurringScheduleRecord): Timing => {
  switch (record.kind) {
    case 'cron':
      return { kind: 'cron', expression: record.expression, timeZone: record.timeZone }
    case 'daily':
      return { kind: 'daily', time: record.time, timeZone: record.timeZone }
    case 'weekly':
      return { kind: 'weekly', time: record.time, timeZone: record.timeZone, weekdays: [...record.weekdays] }
    case 'every':
      return { kind: 'every', everySeconds: record.everySeconds }
  }
}

/** The record the resolver reads for a committed target: the canonical rule plus the earliest unaccepted instant. */
const committed = (timing: Timing, scheduledAt: string): RecurringScheduleRecord => {
  switch (timing.kind) {
    case 'cron':
      return { id: ID, kind: 'cron', title: PLACEHOLDER, prompt: PLACEHOLDER, expression: timing.expression, timeZone: timing.timeZone, scheduledAt }
    case 'daily':
      return { id: ID, kind: 'daily', title: PLACEHOLDER, prompt: PLACEHOLDER, time: timing.time, timeZone: timing.timeZone, scheduledAt }
    case 'weekly':
      return {
        id: ID,
        kind: 'weekly',
        title: PLACEHOLDER,
        prompt: PLACEHOLDER,
        time: timing.time,
        timeZone: timing.timeZone,
        weekdays: [...timing.weekdays],
        scheduledAt,
      }
    case 'every':
      return { id: ID, kind: 'every', title: PLACEHOLDER, prompt: PLACEHOLDER, everySeconds: timing.everySeconds, scheduledAt }
  }
}

export class ScheduleModel {
  /**
   * Validate a rule and commit its first target strictly after `now`. The returned timing is canonical (the zone's
   * IANA name, `HH:mm:ss.SSS`, sorted weekdays, a canonical cron expression), so an equivalent edit compares equal.
   */
  static plan(timing: Timing, now: number): TimingResult<{ readonly timing: Timing; readonly nextRunAt: string }> {
    try {
      const record = recordOf(timing, now)
      return { ok: true, value: { timing: timingOf(record), nextRunAt: record.scheduledAt } }
    } catch (cause) {
      return failure(cause)
    }
  }

  /**
   * Decide one due target. A Host that was down across several targets runs once, for the latest occurrence due at
   * `now`, and commits the first target after `now`; `undefined` while the committed target is still in the future.
   * `nextRunAt` is null once the rule has no representable future instant.
   */
  static due(timing: Timing, nextRunAt: string, now: number): { readonly occurrenceAt: string; readonly nextRunAt: string | null } | undefined {
    if (Date.parse(nextRunAt) > now) return undefined
    const decision = resolveRecurringOccurrence(committed(timing, nextRunAt), now)
    return { occurrenceAt: decision.occurrenceAt, nextRunAt: decision.nextScheduledAt ?? null }
  }

  /** One line for a list row or an agent: `cron 0 9 * * 1-5 (Europe/Paris)`. */
  static describe(timing: Timing): string {
    switch (timing.kind) {
      case 'cron':
        return `cron ${timing.expression} (${timing.timeZone})`
      case 'daily':
        return `daily at ${timing.time.slice(0, 5)} (${timing.timeZone})`
      case 'weekly':
        return `weekly on ${timing.weekdays.map(day => WEEKDAYS[day - 1] ?? String(day)).join(', ')} at ${timing.time.slice(0, 5)} (${timing.timeZone})`
      case 'every':
        return timing.everySeconds % 3600 === 0
          ? `every ${String(timing.everySeconds / 3600)} h`
          : timing.everySeconds % 60 === 0
            ? `every ${String(timing.everySeconds / 60)} min`
            : `every ${String(timing.everySeconds)} s`
    }
  }
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
