/** A fixed-window counter per key, held in memory: a restart forgets it, which only ever loosens the limit. */
export interface RateWindow {
  readonly limit: number
  readonly windowMs: number
}

export interface RateDecision {
  readonly allowed: boolean
  /** Seconds until the key's window resets; sent as Retry-After when refused. */
  readonly retryAfterSeconds: number
}

/** At most this many keys are tracked; the oldest windows are dropped first so a scan cannot grow memory. */
const MAX_KEYS = 10_000

export class RateLimiter {
  readonly #windows = new Map<string, { start: number; count: number }>()

  constructor(readonly window: RateWindow) {}

  hit(key: string, now: number): RateDecision {
    const current = this.#windows.get(key)
    const fresh = current === undefined || now - current.start >= this.window.windowMs
    const entry = fresh ? { start: now, count: 0 } : current
    entry.count += 1
    if (fresh) {
      this.#windows.delete(key)
      this.#windows.set(key, entry)
      this.#evict(now)
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.start + this.window.windowMs - now) / 1000))
    return { allowed: entry.count <= this.window.limit, retryAfterSeconds }
  }

  /** Whether the key is already over its limit, without counting a hit. */
  blocked(key: string, now: number): RateDecision {
    const current = this.#windows.get(key)
    if (current === undefined || now - current.start >= this.window.windowMs) return { allowed: true, retryAfterSeconds: 0 }
    return { allowed: current.count < this.window.limit, retryAfterSeconds: Math.max(1, Math.ceil((current.start + this.window.windowMs - now) / 1000)) }
  }

  #evict(now: number): void {
    for (const [key, entry] of this.#windows) {
      if (this.#windows.size <= MAX_KEYS && now - entry.start < this.window.windowMs) return
      this.#windows.delete(key)
    }
  }
}
