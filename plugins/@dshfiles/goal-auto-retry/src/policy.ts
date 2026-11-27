/**
 * When a goal should come back after its provider refused the round.
 *
 * DSH's goal round driver disarms automatic continuation on `agent/error`, so a
 * quota or rate-limit refusal pauses the goal and waits for a human. Everything
 * here is pure: the Host half owns the timer and the goal service, this module
 * only answers "is this failure retryable" and "when".
 */

/** Failure codes that mean the account, not the request, has to wait. */
export const RETRYABLE_CODES: readonly string[] = ['ACCOUNT_QUOTA', 'ACCOUNT_SIGN_IN_REQUIRED', 'ACCOUNT_TOKEN_INVALID', 'PI_AI_ERROR', 'QUOTA', 'RATE_LIMIT']

/**
 * `PI_AI_ERROR` is the provider-neutral fallback pi-ai reports when it has no
 * more specific code, so the message decides whether it is a waitable account
 * refusal or something a retry will only repeat.
 */
const PI_AI_REFUSAL_PATTERN = /usage limit|rate.?limit|quota|resets?|try again|too many requests|out of credits|you can retry/i

export interface FailureFacts {
  readonly code: string
  readonly message: string
  readonly resetAtMs?: number
}

/** The failure a turn ended with, as the goal auto retry reads it. */
export interface RetryFailure {
  readonly code: string
  readonly message: string
  /** Absolute epoch milliseconds the provider said the limit lifts, when it said so. */
  readonly resetAt?: number
}

const UNIT_MS = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
} as const

/**
 * `Try again in ~246 min`, `2 hours 30 minutes`, `1h30m`, `45s`. A unit letter
 * that the next character continues (`30m` in `30min`) belongs to a longer
 * word, so a bare `h`/`m`/`s` only counts when what follows cannot extend it.
 */
const relativePattern = /(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)(?=[\d\s.,;:!?)\]]|$)/gi

const unitOf = (token: string): keyof typeof UNIT_MS => {
  const lower = token.toLowerCase()
  if (lower.startsWith('d')) return 'day'
  if (lower.startsWith('h')) return 'hour'
  if (lower.startsWith('s')) return 'second'
  return 'minute'
}

/**
 * The wait a provider stated in prose, if it stated one.
 *
 * Only the first duration unit of each magnicude counts: providers write either
 * `1 hour 30 minutes` or `1h30m`, never both in one message, and summing every
 * number in a sentence would read `slot 3 of 5, retry in 10 minutes` as an hour.
 */
const parseRelativeWaitMs = (message: string): number | undefined => {
  const found = new Map<keyof typeof UNIT_MS, number>()
  for (const match of message.matchAll(relativePattern)) {
    const amount = Number(match[1])
    const unit = unitOf(match[2] ?? '')
    if (!Number.isFinite(amount) || amount < 0) continue
    if (!found.has(unit)) found.set(unit, amount)
  }
  if (found.size === 0) return undefined
  let total = 0
  for (const [unit, amount] of found) total += amount * UNIT_MS[unit]
  return total > 0 ? total : undefined
}

/** The absolute reset an ISO timestamp in the message names, if any. */
const parseAbsoluteWaitMs = (message: string, now: number): number | undefined => {
  const iso = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))/i.exec(message)
  if (iso?.[1] === undefined) return undefined
  const timestamp = Date.parse(iso[1])
  if (Number.isNaN(timestamp) || timestamp <= now) return undefined
  return timestamp - now
}

/**
 * The wait the failure itself carries: the adapter's parsed `Retry-After`, else
 * the reset instant its message states, else the duration its message states.
 *
 * @returns milliseconds to wait, or `undefined` when the provider said nothing.
 */
const statedWaitMs = (failure: FailureFacts, now: number): number | undefined => {
  if (failure.resetAtMs !== undefined && Number.isFinite(failure.resetAtMs) && failure.resetAtMs > now) {
    return failure.resetAtMs - now
  }
  return parseAbsoluteWaitMs(failure.message, now) ?? parseRelativeWaitMs(failure.message)
}

/** What a provider's own words say about when its limit lifts. */
export class ProviderTiming {
  /** The wait the failure carries: adapter `Retry-After`, a stated instant, or a stated duration. */
  static waitMs(failure: FailureFacts, now: number): number | undefined {
    return statedWaitMs(failure, now)
  }

  /** The instant the limit lifts, or `undefined` when the failure said nothing usable. */
  static resetAt(failure: FailureFacts, now: number): number | undefined {
    const wait = statedWaitMs(failure, now)
    return wait === undefined ? undefined : now + wait
  }
}

/**
 * Retryable account refusals. Everything else (auth, invalid request, context
 * overflow, transport) is left to the human or to DSH's own request retry: a
 * goal round repeating a failure DSH will not repeat pays tokens to learn nothing.
 */
const retryable = (failure: FailureFacts): boolean => {
  if (failure.code === 'PI_AI_ERROR') return PI_AI_REFUSAL_PATTERN.test(failure.message)
  return RETRYABLE_CODES.includes(failure.code)
}

/** The policy the Host applies to one refusal: is it an account wait, and when does it end. */
export class RetryPolicy {
  /** Whether this failure is the account being made to wait, not the request being wrong. */
  static isRetryableFailure(failure: FailureFacts): boolean {
    return retryable(failure)
  }
}

/** When the Host will resume, and which input decided it. */
export interface RetryPlan {
  readonly at: number
  readonly delayMs: number
  readonly source: 'override' | 'reset' | 'backoff'
}

/**
 * When to retry.
 *
 * A provider that stated its reset is trusted: retry `marginMs` after it, plus a
 * floor of `minimumDelayMs` so a refusal that claims "2 seconds" still waits a
 * minute and the margin. A provider that stated nothing gets exponential
 * backoff from `baseDelayMs`, so a silent refusal still comes back rather than
 * waiting for a human who may be asleep.
 */
export const planRetry = (input: {
  readonly failure: FailureFacts
  readonly now: number
  /** The user's own retry delay, which overrides whatever the provider said. */
  readonly overrideDelayMs?: number | undefined
  readonly attempt: number
  readonly marginMs: number
  readonly minimumDelayMs: number
  readonly baseDelayMs: number
  readonly maxBackoffMs: number
}): RetryPlan => {
  const override = input.overrideDelayMs
  if (override !== undefined && override > 0) {
    return { at: input.now + override, delayMs: override, source: 'override' }
  }
  const stated = statedWaitMs(input.failure, input.now)
  if (stated === undefined) {
    const delayMs = Math.min(input.maxBackoffMs, input.baseDelayMs * 2 ** Math.max(0, input.attempt - 1))
    return { at: input.now + delayMs, delayMs, source: 'backoff' }
  }
  const delayMs = Math.max(input.minimumDelayMs, input.marginMs + stated)
  return { at: input.now + delayMs, delayMs, source: 'reset' }
}

/** What the Host half keeps about one Session's pending retry. */
export interface PendingRetry {
  readonly sessionId: string
  readonly goalId: string
  readonly revision: number
  readonly attempt: number
  readonly at: number
  readonly delayMs: number
  readonly source: 'override' | 'reset' | 'backoff'
  readonly failure: RetryFailure
}

/** The state a Session's retry surface shows. */
export type RetryStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'scheduled'; readonly retry: PendingRetry }
  | { readonly kind: 'failed'; readonly retry: PendingRetry; readonly reason: string }

/** A human-readable wait, for banners and logs. */
export const describeWait = (delayMs: number): string => {
  const seconds = Math.max(1, Math.round(delayMs / 1_000))
  if (seconds < 90) return `${String(seconds)}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${String(minutes)} min`
  const hours = Math.round(minutes / 6) / 10
  return `${String(hours)} h`
}
