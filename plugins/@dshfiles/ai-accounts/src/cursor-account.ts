import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as Schema from 'effect/Schema'
import type { UsageCard } from './api.js'
import { CodexHomeModel } from './codex-home.js'
import { CredentialModel, type CredentialValueResolver } from './credentials.js'
import { AiAccountsSchema } from './effect-schema.js'
import { readKeychainSecret } from './keychain.js'
import { ProviderUsageModel } from './usage.js'
import { providerFetch } from './provider-request.js'

type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/**
 * Cursor accounts.
 *
 * Cursor has no public chat API, so a Cursor account publishes no model route:
 * its sessions run through the `@dshfiles/cursor-agent` runtime driver. This
 * account tracks identity and included-usage quota only. The token is the one
 * `cursor-agent login` stores (macOS keychain, or `~/.config/cursor/auth.json`),
 * or a token the account names in an environment variable.
 *
 * Cursor documents no usage API. The dashboard's own `usage-summary` endpoint is
 * read with the CLI token presented as the dashboard session cookie; a response
 * that does not match the expected shape reports "unsupported" rather than a
 * guessed number.
 */

const CURSOR_USAGE_URL = 'https://cursor.com/api/usage-summary'

export const CURSOR_LOGIN_HINT = 'cursor-agent login'

const fileAuthSchema = Schema.Struct({ accessToken: Schema.String.check(Schema.isMinLength(1)) })

export const readCursorToken = async (
  keyEnv: string,
  resolveCredential?: CredentialValueResolver,
  authSource?: 'cli' | 'reference',
): Promise<string | undefined> => {
  const named = authSource === 'cli' ? '' : resolveCredential === undefined ? CredentialModel.readKeyFromEnv(keyEnv) : await resolveCredential(keyEnv)
  if (named.length > 0) return named
  if (authSource === 'reference') return undefined
  const fromKeychain = await readKeychainSecret({ service: 'cursor-access-token', account: 'cursor-user' })
  if (fromKeychain !== undefined) return fromKeychain
  try {
    const parsed = AiAccountsSchema.decodeResult(fileAuthSchema, JSON.parse(await readFile(join(homedir(), '.config', 'cursor', 'auth.json'), 'utf8')))
    return parsed._tag === 'Success' ? parsed.success.accessToken : undefined
  } catch {
    return undefined
  }
}

const planSchema = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  used: Schema.optional(Schema.Number.check(Schema.isFinite())),
  limit: Schema.optional(Schema.Number.check(Schema.isFinite())),
  totalPercentUsed: Schema.optional(Schema.Number.check(Schema.isFinite())),
})

const cursorUsageSchema = Schema.Struct({
  billingCycleEnd: Schema.optional(Schema.String),
  membershipType: Schema.optional(Schema.String),
  individualUsage: Schema.optional(Schema.NullOr(Schema.Struct({ plan: Schema.optional(Schema.NullOr(planSchema)) }))),
})

export class CursorAccountModel {
  /** The dashboard cookie pairs the JWT subject's user id with the token. */
  static cursorSessionCookie = (token: string): string | undefined => {
    const parsedSubject = AiAccountsSchema.decodeResult(Schema.String.check(Schema.isMinLength(1)), CodexHomeModel.decodeJwtPayload(token)?.sub)
    if (parsedSubject._tag !== 'Success') return undefined
    const subject = parsedSubject.success
    const userId = subject.includes('|') ? subject.slice(subject.lastIndexOf('|') + 1) : subject
    return `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${token}`)}`
  }

  static parseCursorUsage = (raw: JsonValue): UsageCard => {
    const parsed = AiAccountsSchema.decodeResult(cursorUsageSchema, raw)
    if (parsed._tag !== 'Success') return ProviderUsageModel.emptyUsage('unsupported', 'Cursor answered in a shape this plugin does not recognise.')
    const plan = parsed.success.individualUsage?.plan
    const usedPercent =
      plan?.totalPercentUsed ?? (plan?.used !== undefined && plan.limit !== undefined && plan.limit > 0 ? (plan.used / plan.limit) * 100 : undefined)
    const resetsAt = parsed.success.billingCycleEnd === undefined ? Number.NaN : Date.parse(parsed.success.billingCycleEnd)
    if (usedPercent === undefined) {
      return {
        ...ProviderUsageModel.emptyUsage('unsupported', 'Cursor reported no included-usage limit for this plan.'),
        plan: parsed.success.membershipType ?? null,
      }
    }
    return {
      status: 'ok',
      message: null,
      identity: null,
      plan: parsed.success.membershipType ?? null,
      windows: [
        { label: 'Monthly limit', percentRemaining: ProviderUsageModel.remainingFromUsed(usedPercent), resetsAt: Number.isNaN(resetsAt) ? null : resetsAt },
      ],
      bankedResets: 0,
      bankedResetExpiries: [],
    }
  }
}

export const readCursorUsage = async (
  keyEnv: string,
  signal?: AbortSignal,
  resolveCredential?: CredentialValueResolver,
  onAuthenticated?: () => void,
  authSource?: 'cli' | 'reference',
): Promise<UsageCard> => {
  if (signal?.aborted) return ProviderUsageModel.emptyUsage('error', 'Usage collection was cancelled.')
  const token = await readCursorToken(keyEnv, resolveCredential, authSource)
  if (token === undefined) return ProviderUsageModel.emptyUsage('unauthenticated', `Sign in with ${CURSOR_LOGIN_HINT}.`)
  const cookie = CursorAccountModel.cursorSessionCookie(token)
  if (cookie === undefined)
    return ProviderUsageModel.emptyUsage('unsupported', 'This Cursor token does not identify a user, so its dashboard usage cannot be read.')
  try {
    const response = await providerFetch({
      provider: 'cursor',
      operation: 'usage',
      url: CURSOR_USAGE_URL,
      init: { headers: { cookie, accept: 'application/json' }, redirect: 'error', signal: ProviderUsageModel.usageSignal(signal) },
    })
    if (response.status === 401 || response.status === 403)
      return ProviderUsageModel.emptyUsage('unauthenticated', `Cursor rejected this login; run ${CURSOR_LOGIN_HINT}.`)
    if (!response.ok) return ProviderUsageModel.emptyUsage('error', `Cursor returned ${String(response.status)} for usage.`)
    const raw: JsonValue = await response.json()
    const parsed = AiAccountsSchema.decodeResult(cursorUsageSchema, raw)
    if (parsed._tag === 'Success') {
      const plan = parsed.success.individualUsage?.plan
      const positive =
        parsed.success.membershipType?.trim() ||
        plan === null ||
        plan?.enabled !== undefined ||
        plan?.totalPercentUsed !== undefined ||
        (plan?.used !== undefined && plan.limit !== undefined)
      if (positive && !signal?.aborted) onAuthenticated?.()
    }
    return CursorAccountModel.parseCursorUsage(raw)
  } catch (cause) {
    return ProviderUsageModel.emptyUsage('error', cause instanceof Error ? cause.message : 'Cursor usage could not be read.')
  }
}
