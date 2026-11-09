/**
 * A quota recovery whose provider never named a reset still gets a timer: the
 * retry backs off 30 s, 1 min, 3 min, 5 min, then every 10 min, so a spent plan
 * that silently recovers is retried without the user watching the thread, and a
 * plan still spent on the first retry is not hammered every 30 s forever.
 */
const QUOTA_RETRY_BACKOFF_MS: readonly number[] = [30_000, 60_000, 180_000, 300_000, 600_000]

const LAST_ATTEMPT_INDEX = QUOTA_RETRY_BACKOFF_MS.length - 1

/** The delay before a recovery's `attempt + 1`-th try; the last rung repeats for every later attempt. */
export const quotaRetryDelayMs = (attempt: number): number => {
  const index = Number.isSafeInteger(attempt) && attempt > 0 ? Math.min(attempt, LAST_ATTEMPT_INDEX) : 0
  return QUOTA_RETRY_BACKOFF_MS[index] ?? 600_000
}

/** When an unknown-reset recovery next retries, counted from the failure it recorded. */
export const quotaRetryAt = (input: { readonly failedAt: number; readonly attempt: number }): number => input.failedAt + quotaRetryDelayMs(input.attempt)
