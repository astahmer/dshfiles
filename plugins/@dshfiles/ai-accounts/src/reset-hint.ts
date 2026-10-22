const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
/** A day is the longest a declared reset is trusted; a plan that resets further out is retried by hand. */
export const MAX_RESET_WAIT_MS = 24 * HOUR_MS

/** `Try again in ~242 min.`, `try again in 5 minutes`, `Try again in 2 hours`. */
const DURATION_HINT = /\btry again in\s*~?\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i
/** `resets 2:10am`, `resets 3:00 PM`, `resets at 17:30`. */
const CLOCK_HINT = /\bresets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i

const durationFor = (match: RegExpExecArray): number | undefined => {
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  const unit = match[2] ?? ''
  return amount * (/^h/i.test(unit) ? HOUR_MS : MINUTE_MS)
}

const clockFor = (match: RegExpExecArray, now: number): number | undefined => {
  const hour = Number(match[1])
  const minute = match[2] === undefined ? 0 : Number(match[2])
  if (!Number.isInteger(hour) || hour > 23 || !Number.isInteger(minute) || minute > 59) return undefined
  const meridiem = match[3]?.toLowerCase()
  const hour24 = meridiem === 'am' ? (hour === 12 ? 0 : hour) : meridiem === 'pm' ? (hour === 12 ? 12 : hour + 12) : hour
  const target = new Date(now)
  target.setHours(hour24, minute, 0, 0)
  if (target.getTime() <= now) target.setDate(target.getDate() + 1)
  return target.getTime() - now
}

/**
 * How long a failure text says its account stays spent: the provider's own declared reset, or
 * `undefined` when the message names none. The wait is capped at {@link MAX_RESET_WAIT_MS}, so a
 * plan that resets tomorrow still ends a turn instead of cooling an account forever.
 */
export const declaredResetWaitMs = (message: string, now: number): number | undefined => {
  if (!Number.isFinite(now) || now < 0) return undefined
  const duration = DURATION_HINT.exec(message)
  const clock = CLOCK_HINT.exec(message)
  const wait = duration !== null ? durationFor(duration) : clock === null ? undefined : clockFor(clock, now)
  if (wait === undefined || !Number.isFinite(wait) || wait <= 0) return undefined
  return Math.min(wait, MAX_RESET_WAIT_MS)
}

export class ResetHintModel {
  static readonly declaredResetWaitMs = declaredResetWaitMs
}
