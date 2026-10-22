import type { UsageCard } from './api.js'

export const knownQuotaResetAt = (usage: UsageCard, now: number): number | null => {
  if (usage.status !== 'ok' || !Number.isSafeInteger(now) || now < 0) return null

  let exhaustedWindows = 0
  let latestResetAt: number | undefined
  for (const window of usage.windows) {
    if (!Number.isFinite(window.percentRemaining)) return null
    if (window.percentRemaining > 0) continue

    exhaustedWindows += 1
    if (window.resetsAt === null || !Number.isSafeInteger(window.resetsAt) || window.resetsAt <= now) return null
    latestResetAt = Math.max(latestResetAt ?? window.resetsAt, window.resetsAt)
  }

  if (exhaustedWindows === 0) return null
  return latestResetAt ?? null
}

const MAX_RESET_AHEAD_MS = 7 * 24 * 60 * 60_000
const DAY_MS = 24 * 60 * 60_000

/** `resets 3:00 PM`, `resets at 15:00`, `resets 3pm (Europe/Paris)`. */
const CLOCK_RESET = /\bresets?\b[^.\n]{0,24}?\b(\d{1,2})(?::([0-5]\d))?\s*([ap]m)?(?:\s*\(([A-Za-z][A-Za-z_+\-/]*\/[A-Za-z_+\-/]+|[A-Za-z]+)\))?/i
/** `Try again in ~151 min`, `retry after 2 hours`. */
const RELATIVE_RESET = /\b(?:in|after)\s*~?\s*(\d{1,3})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i

const zoneOf = (name: string | undefined): string | undefined => {
  if (name === undefined) return undefined
  if (name.toUpperCase() !== 'UTC' && !name.includes('/')) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return name
  } catch {
    return undefined
  }
}

const zoneOffsetMs = (instant: number, zone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(instant)
  const value = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? 0)
  const wall = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour') % 24, value('minute'), value('second'))
  return wall - Math.floor(instant / 1_000) * 1_000
}

/**
 * The next occurrence of a wall-clock reset named by a provider message. The
 * usage card stays authoritative; this only covers plans whose spend cap the
 * provider's usage endpoint never reports as a spent window.
 */
const clockResetAt = (input: { readonly hour: number; readonly minute: number; readonly zone: string | undefined; readonly now: number }): number | null => {
  if (input.hour > 23 || input.minute > 59) return null
  const clockParts = { year: 'numeric', month: 'numeric', day: 'numeric', hour12: false } as const
  const formatter =
    input.zone === undefined ? new Intl.DateTimeFormat('en-US', clockParts) : new Intl.DateTimeFormat('en-US', { ...clockParts, timeZone: input.zone })
  const parts = formatter.formatToParts(input.now)
  const value = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? 0)
  const wall = Date.UTC(value('year'), value('month') - 1, value('day'), input.hour, input.minute)
  const offset = input.zone === undefined ? -new Date(input.now).getTimezoneOffset() * 60_000 : zoneOffsetMs(input.now, input.zone)
  let at = wall - offset
  if (at <= input.now) at += DAY_MS
  return at > input.now && at - input.now <= MAX_RESET_AHEAD_MS ? at : null
}

/** A reset time the provider states in its failure message, or `null` when it states none. */
export const resetAtFromMessage = (message: string, now: number): number | null => {
  if (!Number.isSafeInteger(now) || now < 0) return null
  const relative = RELATIVE_RESET.exec(message)
  if (relative !== null) {
    const amount = Number(relative[1])
    const at = now + (/^h/i.test(relative[2] ?? '') ? amount * 60 : amount) * 60_000
    return at > now && at - now <= MAX_RESET_AHEAD_MS ? at : null
  }
  const clock = CLOCK_RESET.exec(message)
  if (clock === null) return null
  const zone = zoneOf(clock[4])
  // A named zone we cannot resolve is not the reader's zone; keep the reset unknown instead.
  if (clock[4] !== undefined && zone === undefined) return null
  const hour = Number(clock[1])
  const meridiem = clock[3]?.toLowerCase()
  const hour24 = meridiem === 'pm' && hour < 12 ? hour + 12 : meridiem === 'am' && hour === 12 ? 0 : hour
  return clockResetAt({ hour: hour24, minute: Number(clock[2] ?? 0), zone, now })
}
