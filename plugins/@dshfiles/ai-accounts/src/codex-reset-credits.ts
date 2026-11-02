import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as Schema from 'effect/Schema'
import { AiAccountsSchema } from './effect-schema.js'
import { providerFetch } from './provider-request.js'

/**
 * Codex reset credits.
 *
 * Banked resets are how a plan survives a weekly cap, and the quota endpoint does
 * not carry them: they come from their own endpoint. Reading an inline field
 * from the usage response therefore reports zero banked resets for an account
 * that may well have several, which is worse than not showing the row at all.
 *
 * One bounded request per Codex home, reusing the login already in that home.
 */

const RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'

const authSchema = Schema.Struct({
  tokens: Schema.Struct({
    access_token: Schema.String.check(Schema.isMinLength(1)),
    account_id: Schema.optional(Schema.String),
  }),
})

const resetCreditsSchema = Schema.Struct({
  available_count: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  credits: Schema.optional(
    Schema.Array(
      Schema.Struct({
        status: Schema.optional(Schema.String),
        expires_at: Schema.optional(Schema.String),
      }),
    ),
  ),
})

export interface BankedReset {
  /** Epoch milliseconds, or `undefined` when the provider omits an expiry. */
  readonly expiresAt: number | undefined
}

export interface CodexResetCredits {
  readonly available: number
  readonly resets: readonly BankedReset[]
}

const emptyResetCredits: CodexResetCredits = { available: 0, resets: [] }

const parseCredits = (value: unknown): CodexResetCredits => {
  const parsed = AiAccountsSchema.decodeResult(resetCreditsSchema, value)
  if (parsed._tag !== 'Success') return emptyResetCredits
  const available = (parsed.success.credits ?? []).filter(credit => credit.status === 'available')
  const resets = available.flatMap(credit => {
    const parsedExpiry = credit.expires_at === undefined ? undefined : Date.parse(credit.expires_at)
    return [{ expiresAt: parsedExpiry === undefined || Number.isNaN(parsedExpiry) ? undefined : parsedExpiry }]
  })
  return {
    available: parsed.success.available_count ?? available.length,
    resets: resets,
  }
}

/** Read how many reset credits an account has banked, and when they expire. */
export const readCodexResetCredits = async (codexHome: string, signal?: AbortSignal): Promise<CodexResetCredits> => {
  let auth: typeof authSchema.Type
  try {
    auth = AiAccountsSchema.decode(authSchema, JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8')))
  } catch {
    return emptyResetCredits
  }
  const accountId = auth.tokens.account_id
  if (accountId === undefined) return emptyResetCredits

  try {
    const response = await providerFetch({
      provider: 'codex',
      operation: 'credits',
      url: RESET_CREDITS_URL,
      init: {
        headers: {
          authorization: `Bearer ${auth.tokens.access_token}`,
          'chatgpt-account-id': accountId,
          accept: 'application/json',
        },
        redirect: 'error',
        signal: signal === undefined ? AbortSignal.timeout(5_000) : AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
      },
    })
    if (!response.ok) return emptyResetCredits
    return parseCredits(await response.json())
  } catch {
    // A provider that cannot answer costs this row, not the panel.
    return emptyResetCredits
  }
}
