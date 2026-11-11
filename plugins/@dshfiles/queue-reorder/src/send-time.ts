/** Send-later times in the browser's own time zone: the presets, the label a scheduled row shows, and the custom field. */

const MINUTE = 60_000

export interface SendPreset {
  readonly label: string
  readonly at: number
}

const atHour = (day: Date, hour: number): Date => {
  const next = new Date(day)
  next.setHours(hour, 0, 0, 0)
  return next
}

const addDays = (day: Date, days: number): Date => {
  const next = new Date(day)
  next.setDate(next.getDate() + days)
  return next
}

/** The next Monday strictly after `now`'s date. */
const nextMonday = (now: Date): Date => addDays(now, (8 - now.getDay()) % 7 || 7)

const pad = (value: number): string => String(value).padStart(2, '0')

const clock = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}`

const sameDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()

const presets = (now: Date): readonly SendPreset[] => {
  const from = now.getTime()
  const tomorrowMorning = atHour(addDays(now, 1), 9)
  const monday = atHour(nextMonday(now), 9)
  return [
    { label: 'In 30 minutes', at: from + 30 * MINUTE },
    { label: 'In 1 hour', at: from + 60 * MINUTE },
    { label: 'In 3 hours', at: from + 180 * MINUTE },
    { label: `Tomorrow at ${clock(tomorrowMorning)}`, at: tomorrowMorning.getTime() },
    ...(sameDay(monday, tomorrowMorning) ? [] : [{ label: `Monday at ${clock(monday)}`, at: monday.getTime() }]),
  ]
}

/** "Today 14:30", "Tomorrow 09:00", or "Mon 17 Nov 09:00". */
const label = (at: number, now: Date): string => {
  const date = new Date(at)
  if (sameDay(date, now)) return `Today ${clock(date)}`
  if (sameDay(date, addDays(now, 1))) return `Tomorrow ${clock(date)}`
  return `${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${clock(date)}`
}

/** The value a `datetime-local` field shows for an instant. */
const toLocalInput = (at: number): string => {
  const date = new Date(at)
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${clock(date)}`
}

/** The instant a `datetime-local` value names; undefined while the field is incomplete. */
const fromLocalInput = (value: string): number | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(value)) return undefined
  const at = new Date(value).getTime()
  return Number.isFinite(at) ? at : undefined
}

export class SendTime {
  static readonly presets = presets
  static readonly label = label
  static readonly toLocalInput = toLocalInput
  static readonly fromLocalInput = fromLocalInput
}
