import { createHmac, timingSafeEqual } from 'node:crypto'

export const SIGNATURE_HEADER = 'x-dsh-signature'
export const TIMESTAMP_HEADER = 'x-dsh-timestamp'

/** A request older or newer than this is refused, so a captured request cannot be replayed later. */
export const REPLAY_WINDOW_SECONDS = 300

export type SignatureRejection = 'missing-signature' | 'malformed-signature' | 'stale-timestamp' | 'bad-signature' | 'replayed'

export type SignatureVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: SignatureRejection }

const SIGNATURE = /^sha256=([0-9a-f]{64})$/u
const TIMESTAMP = /^\d{1,12}$/u

/** The bytes the sender signs: the Unix timestamp in seconds, a dot, then the raw request body. */
const signedBytes = (timestamp: string, body: Uint8Array): Buffer => Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), body])

/**
 * Signatures seen inside the replay window. A signature names one (timestamp, body) pair, so seeing it twice inside
 * the window is a replay; outside the window the timestamp check refuses it anyway, so entries expire with it.
 */
export class ReplayGuard {
  readonly #seen = new Map<string, number>()

  /** False when the signature was already accepted and has not expired; otherwise remember it until `expiresAt`. */
  claim(signature: string, expiresAt: number, now: number): boolean {
    for (const [key, expiry] of this.#seen) if (expiry <= now) this.#seen.delete(key)
    if (this.#seen.has(signature)) return false
    this.#seen.set(signature, expiresAt)
    return true
  }

  get size(): number {
    return this.#seen.size
  }
}

export class WebhookSignature {
  /** `sha256=<hex>` of HMAC-SHA256(secret, `${timestamp}.${body}`): what a sender puts in `x-dsh-signature`. */
  static sign(input: { readonly secret: string; readonly timestamp: string; readonly body: Uint8Array }): string {
    return `sha256=${createHmac('sha256', input.secret).update(signedBytes(input.timestamp, input.body)).digest('hex')}`
  }

  /**
   * Check the signature header against the referenced secret, in constant time, then the timestamp window, then the
   * replay guard. Only a valid signature is remembered, so an attacker cannot poison the guard.
   */
  static verify(input: {
    readonly secret: string
    readonly body: Uint8Array
    readonly signature: string | undefined
    readonly timestamp: string | undefined
    readonly now: number
    readonly guard: ReplayGuard
  }): SignatureVerdict {
    if (input.signature === undefined || input.timestamp === undefined) return { ok: false, reason: 'missing-signature' }
    const presented = SIGNATURE.exec(input.signature.trim().toLowerCase())?.[1]
    const timestamp = input.timestamp.trim()
    if (presented === undefined || !TIMESTAMP.test(timestamp)) return { ok: false, reason: 'malformed-signature' }
    const expected = createHmac('sha256', input.secret).update(signedBytes(timestamp, input.body)).digest()
    if (!timingSafeEqual(expected, Buffer.from(presented, 'hex'))) return { ok: false, reason: 'bad-signature' }
    const sentAt = Number(timestamp) * 1000
    if (Math.abs(input.now - sentAt) > REPLAY_WINDOW_SECONDS * 1000) return { ok: false, reason: 'stale-timestamp' }
    if (!input.guard.claim(presented, sentAt + REPLAY_WINDOW_SECONDS * 1000, input.now)) return { ok: false, reason: 'replayed' }
    return { ok: true }
  }
}
