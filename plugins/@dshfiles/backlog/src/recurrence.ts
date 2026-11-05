import { Schema } from 'effect'
import { DueDates } from './due-date.js'

/** How far ahead a cron rule is searched for its next matching day before it counts as never matching. */
const MAX_SCAN_DAYS = 366 * 5

type FieldSet = ReadonlySet<number> | 'any'

/** One cron field (`*`, `5`, `1-5`, `*\/2`, `1,15`) as the set of values it allows, or null when it is not valid. */
const parseField = (field: string, min: number, max: number): FieldSet | null => {
  if (field === '*' || field === '?') return 'any'
  const values = new Set<number>()
  for (const part of field.split(',')) {
    const match = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part)
    if (match === null) return null
    const start = match[1] === '*' ? min : Number(match[1])
    const end = match[2] !== undefined ? Number(match[2]) : match[1] === '*' || match[3] !== undefined ? max : start
    const step = match[3] === undefined ? 1 : Number(match[3])
    if (start < min || end > max || start > end || step < 1) return null
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return values
}

/** The day fields of a five-field cron rule; minute and hour are checked for shape but a due date has no time. */
const parseCron = (expression: string) => {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minute = '', hour = '', dayOfMonth = '', month = '', dayOfWeek = ''] = fields
  if (parseField(minute, 0, 59) === null || parseField(hour, 0, 23) === null) return null
  const days = parseField(dayOfMonth, 1, 31)
  const months = parseField(month, 1, 12)
  const weekdays = parseField(dayOfWeek.replace(/\b7\b/g, '0'), 0, 6)
  if (days === null || months === null || weekdays === null) return null
  return { days, months, weekdays }
}

const allows = (set: FieldSet, value: number): boolean => set === 'any' || set.has(value)

/** Vixie cron: when both day-of-month and day-of-week are restricted, a day matching either one matches. */
const cronMatches = (rule: NonNullable<ReturnType<typeof parseCron>>, date: string): boolean => {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!allows(rule.months, parsed.getUTCMonth() + 1)) return false
  const dayOk = allows(rule.days, parsed.getUTCDate())
  const weekdayOk = allows(rule.weekdays, parsed.getUTCDay())
  if (rule.days !== 'any' && rule.weekdays !== 'any') return dayOk || weekdayOk
  return dayOk && weekdayOk
}

/** `daily`, `weekly`, `monthly`, or `cron:<five fields>` (only the day fields matter for a date). */
const recurrenceSchema = Schema.String.check(
  Schema.makeFilter(value => {
    if (value === 'daily' || value === 'weekly' || value === 'monthly') return undefined
    if (value.startsWith('cron:') && parseCron(value.slice(5)) !== null) return undefined
    return 'Expected daily, weekly, monthly or cron:<minute hour day-of-month month day-of-week>, such as cron:0 9 * * 1.'
  }),
)

const step = (recurrence: string, date: string): string | null => {
  if (recurrence === 'daily') return DueDates.addDays(date, 1)
  if (recurrence === 'weekly') return DueDates.addDays(date, 7)
  if (recurrence === 'monthly') return DueDates.addMonths(date, 1)
  const rule = recurrence.startsWith('cron:') ? parseCron(recurrence.slice(5)) : null
  if (rule === null) return null
  for (let offset = 1; offset <= MAX_SCAN_DAYS; offset += 1) {
    const candidate = DueDates.addDays(date, offset)
    if (cronMatches(rule, candidate)) return candidate
  }
  return null
}

/**
 * The due date of the next occurrence: one step after the current due date (or today when it had none), stepped again
 * until it lands after today, so finishing a late daily item does not create one already overdue. Null when a cron rule
 * never matches.
 */
const nextDue = (input: { readonly recurrence: string; readonly due: string | undefined; readonly today: string }): string | null => {
  let next = step(input.recurrence, input.due ?? input.today)
  while (next !== null && next <= input.today) next = step(input.recurrence, next)
  return next
}

const label = (recurrence: string): string => {
  if (recurrence === 'daily') return 'Daily'
  if (recurrence === 'weekly') return 'Weekly'
  if (recurrence === 'monthly') return 'Monthly'
  return recurrence.slice(5)
}

export class Recurrence {
  static readonly schema = recurrenceSchema
  static readonly nextDue = nextDue
  static readonly label = label
}
