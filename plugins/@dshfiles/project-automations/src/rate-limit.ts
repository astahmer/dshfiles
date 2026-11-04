export type RateDecision = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterMs: number }

/**
 * A sliding window per key: at most `limit` accepted calls in any `windowMs`. Refused calls are not counted, so a
 * flood cannot keep a key locked out after it stops.
 */
export class SlidingWindowLimiter {
  readonly #hits = new Map<string, number[]>()

  constructor(readonly windowMs: number) {}

  take(key: string, limit: number, now: number): RateDecision {
    const since = now - this.windowMs
    const recent = (this.#hits.get(key) ?? []).filter(at => at > since)
    if (recent.length >= limit) {
      this.#hits.set(key, recent)
      const oldest = recent[0] ?? now
      return { allowed: false, retryAfterMs: Math.max(1, oldest + this.windowMs - now) }
    }
    recent.push(now)
    this.#hits.set(key, recent)
    return { allowed: true }
  }

  forget(key: string): void {
    this.#hits.delete(key)
  }
}
