import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpResponses } from './http.js'
import { PAIR_WINDOW_MS } from './limits.js'

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-z]{32}$/

export interface PairingStatus {
  readonly armed: boolean
  readonly expiresAt?: number
  readonly pairedAt?: number
}

export interface Pairing {
  arm(): PairingStatus
  status(): PairingStatus
  /** Hands the token over once, only while the user-armed window is open. */
  take(): string | undefined
}

/**
 * Pairing is a deliberate, short-lived window the user opens in DSH: the extension
 * pulls the token instead of the user copying it. Single use, and it expires on its
 * own, so a missed window leaves no standing invitation.
 */
export const createPairing = ({
  token,
  now = Date.now,
  windowMs = PAIR_WINDOW_MS,
}: {
  readonly token: () => string
  readonly now?: () => number
  readonly windowMs?: number
}): Pairing => {
  let expiresAt: number | undefined
  let pairedAt: number | undefined

  const armed = (): boolean => expiresAt !== undefined && now() < expiresAt

  return {
    arm: () => {
      expiresAt = now() + windowMs
      pairedAt = undefined
      return { armed: true, expiresAt }
    },
    status: () => ({
      armed: armed(),
      ...(expiresAt === undefined ? {} : { expiresAt }),
      ...(pairedAt === undefined ? {} : { pairedAt }),
    }),
    take: () => {
      if (!armed()) return undefined
      expiresAt = undefined
      pairedAt = now()
      return token()
    },
  }
}

export interface PairHandlerOptions {
  readonly pairing: Pairing
  readonly allowedOrigins: () => readonly string[]
}

export const createPairHandler =
  ({ pairing, allowedOrigins }: PairHandlerOptions) =>
  (request: IncomingMessage, response: ServerResponse): void => {
    if (!LOOPBACK.has(request.socket.remoteAddress ?? '')) {
      HttpResponses.respond({ response, status: 403, body: { error: 'loopback only' } })
      return
    }
    const allowed = allowedOrigins()
    if (HttpResponses.answerPreflight({ request, response, allowed })) return
    if (request.method !== 'POST') {
      HttpResponses.respond({ response, status: 405, body: { error: 'method not allowed' } })
      return
    }
    const origin = request.headers.origin
    if (origin === undefined || !EXTENSION_ORIGIN.test(origin)) {
      HttpResponses.respond({ response, status: 403, body: { error: 'browser extension origin required' } })
      return
    }
    if (allowed.length > 0 && !allowed.includes(origin)) {
      HttpResponses.respond({ response, status: 403, body: { error: 'origin not allowed' } })
      return
    }
    const token = pairing.take()
    if (token === undefined) {
      HttpResponses.respond({ response, status: 409, body: { error: 'open the pairing window in DSH first' } })
      return
    }
    HttpResponses.respond({ response, status: 200, body: { token }, headers: HttpResponses.corsFor({ origin, allowed }) })
  }
