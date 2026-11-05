import { Schema } from 'effect'

const DAY_MS = 86_400_000

/** A calendar date with no time: `2026-11-05`. */
const dateSchema = Schema.String.check(
  Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
  Schema.makeFilter(value => {
    const parsed = Date.parse(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed) && new Date(parsed).toISOString().startsWith(value) ? undefined : 'Expected a real calendar date such as 2026-11-05.'
  }),
)

const pad = (value: number): string => String(value).padStart(2, '0')

/** The local calendar date of a moment on the machine reading it. */
const dateOf = (at: number): string => {
  const date = new Date(at)
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const utcOf = (date: string): number => Date.parse(`${date}T00:00:00Z`)

const fromUtc = (at: number): string => new Date(at).toISOString().slice(0, 10)

const addDays = (date: string, days: number): string => fromUtc(utcOf(date) + days * DAY_MS)

/** The same day of the month `months` later, or that month's last day when it is shorter. */
const addMonths = (date: string, months: number): string => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  const index = year * 12 + (month - 1) + months
  const targetYear = Math.floor(index / 12)
  const targetMonth = index % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  return `${String(targetYear)}-${pad(targetMonth + 1)}-${pad(Math.min(day, lastDay))}`
}

/** Whole days from `today` to `date`: negative once it has passed. */
const daysBetween = (today: string, date: string): number => Math.round((utcOf(date) - utcOf(today)) / DAY_MS)

const isOverdue = (input: { readonly due: string | undefined; readonly status: string; readonly today: string }): boolean =>
  input.due !== undefined && input.status !== 'done' && input.status !== 'dropped' && input.due < input.today

/** How a chip names a due date relative to today: Today, Tomorrow, 3d late, Nov 12. */
const label = (input: { readonly due: string; readonly today: string }): string => {
  const days = daysBetween(input.today, input.due)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${String(-days)}d late`
  const date = new Date(utcOf(input.due))
  const month = date.toLocaleString('en', { month: 'short', timeZone: 'UTC' })
  const sameYear = input.due.slice(0, 4) === input.today.slice(0, 4)
  return `${month} ${String(date.getUTCDate())}${sameYear ? '' : ` ${input.due.slice(0, 4)}`}`
}

export class DueDates {
  static readonly schema = dateSchema
  static readonly dateOf = dateOf
  static readonly addDays = addDays
  static readonly addMonths = addMonths
  static readonly daysBetween = daysBetween
  static readonly isOverdue = isOverdue
  static readonly label = label
}
