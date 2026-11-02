import type { IncomingMessage, ServerResponse } from 'node:http'
import { ExtensionHttp } from './http.js'
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
  /** Closes the user-armed window and reports whether it was open, so the token is handed over once. */
  take(): boolean
}

/**
 * Pairing is a deliberate, short-lived window the user opens in DSH: the extension
 * pulls the token instead of the user copying it. Single use, and it expires on its
 * own, so a missed window leaves no standing invitation.
 */
export const createPairing = ({ now = Date.now, windowMs = PAIR_WINDOW_MS }: { readonly now?: () => number; readonly windowMs?: number }): Pairing => {
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
      ...(expiresAt !== undefined && { expiresAt }),
      ...(pairedAt !== undefined && { pairedAt }),
    }),
    take: () => {
      if (!armed()) return false
      expiresAt = undefined
      pairedAt = now()
      return true
    },
  }
}

export interface PairHandlerOptions {
  readonly pairing: Pairing
  readonly token: () => Promise<string>
  readonly allowedOrigins: () => readonly string[]
}

export const createPairHandler =
  ({ pairing, token, allowedOrigins }: PairHandlerOptions) =>
  async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!LOOPBACK.has(request.socket.remoteAddress ?? '')) {
      ExtensionHttp.respond({ response, status: 403, body: { error: 'loopback only' } })
      return
    }
    const allowed = allowedOrigins()
    if (ExtensionHttp.answerPreflight({ request, response, allowed })) return
    if (request.method !== 'POST') {
      ExtensionHttp.respond({ response, status: 405, body: { error: 'method not allowed' } })
      return
    }
    const origin = request.headers.origin
    if (origin === undefined || !EXTENSION_ORIGIN.test(origin)) {
      ExtensionHttp.respond({ response, status: 403, body: { error: 'browser extension origin required' } })
      return
    }
    if (allowed.length > 0 && !allowed.includes(origin)) {
      ExtensionHttp.respond({ response, status: 403, body: { error: 'origin not allowed' } })
      return
    }
    if (!pairing.take()) {
      ExtensionHttp.respond({ response, status: 409, body: { error: 'open the pairing window in DSH first' } })
      return
    }
    ExtensionHttp.respond({ response, status: 200, body: { token: await token() }, headers: ExtensionHttp.corsFor({ origin, allowed }) })
  }
