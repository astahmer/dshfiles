/**
 * One browser-wide memory of what the Host already learned about each address.
 *
 * A click must open the page in the same gesture, so a check that takes a Host round trip can never gate the click
 * itself: `window.open` after an await is popped up blocked. This cache lets the first click open the pane and learn,
 * and every later click (and every warm-up on a listed dev server) decide synchronously.
 */
import type { EmbedCheck, EmbedVerdict } from './embed-policy.js'

/** How long one answer stays usable; a stopped or restarted dev server changes it. */
export const EMBED_CACHE_TTL_MS = 60_000

/** Enough for a thread's servers, its pages and a session's links, without growing with browsing. */
export const EMBED_CACHE_LIMIT = 200

/** The Host call a caller supplies, decoded at its own boundary. */
export type EmbedProbe = (url: string) => Promise<EmbedCheck | undefined>

interface CachedCheck {
  readonly check: EmbedCheck
  readonly at: number
}

export class PreviewEmbedCache {
  static readonly shared = new PreviewEmbedCache()

  readonly #byUrl = new Map<string, CachedCheck>()
  readonly #inflight = new Map<string, Promise<EmbedCheck | undefined>>()

  /** A fresh answer, or undefined when it was never asked or has expired. */
  get(url: string): EmbedCheck | undefined {
    const cached = this.#byUrl.get(url)
    if (cached === undefined) return undefined
    if (Date.now() - cached.at > EMBED_CACHE_TTL_MS) {
      this.#byUrl.delete(url)
      return undefined
    }
    return cached.check
  }

  /** What a click may decide with right now. */
  verdict(url: string): EmbedVerdict {
    const cached = this.get(url)
    if (cached === undefined) return 'unknown'
    if (cached.framing === 'denied') return 'refused'
    return cached.reachable ? 'open' : 'unreachable'
  }

  /**
   * Ask the Host once per URL and cache the answer; a second caller joins the request already in flight.
   * @param input - the address, the Host probe, and what to do when the answer arrives.
   * @returns the answer, also when a request was already in flight.
   */
  ask(input: { readonly url: string; readonly probe: EmbedProbe; readonly onSettled?: (check: EmbedCheck) => void }): Promise<EmbedCheck | undefined> {
    const known = this.get(input.url)
    if (known !== undefined) return Promise.resolve(known)
    const running = this.#inflight.get(input.url)
    if (running !== undefined) return running
    const request = Promise.resolve()
      .then(() => input.probe(input.url))
      .then(check => {
        if (check === undefined) return undefined
        this.#remember(input.url, check)
        input.onSettled?.(check)
        return check
      })
      .catch(() => undefined)
      .finally(() => {
        this.#inflight.delete(input.url)
      })
    this.#inflight.set(input.url, request)
    return request
  }

  /** Forget everything, e.g. after the Host reconnects with new settings. */
  clear(): void {
    this.#byUrl.clear()
    this.#inflight.clear()
  }

  #remember(url: string, check: EmbedCheck): void {
    this.#byUrl.delete(url)
    this.#byUrl.set(url, { check, at: Date.now() })
    while (this.#byUrl.size > EMBED_CACHE_LIMIT) {
      const oldest = this.#byUrl.keys().next()
      if (oldest.done === true) return
      this.#byUrl.delete(oldest.value)
    }
  }
}
