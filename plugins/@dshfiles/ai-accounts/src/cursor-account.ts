import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { UsageCard } from './api.js'
import { decodeJwtPayload } from './codex-home.js'
import { readKeyFromEnv, type CredentialValueResolver } from './credentials.js'
import { readKeychainSecret } from './keychain.js'
import { ProviderUsageModel } from './usage.js'

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

const fileAuthSchema = z.object({ accessToken: z.string().min(1) })

export const readCursorToken = async (keyEnv: string, resolveCredential?: CredentialValueResolver): Promise<string | undefined> => {
  const named = resolveCredential === undefined ? readKeyFromEnv(keyEnv) : await resolveCredential(keyEnv)
  if (named.length > 0) return named
  const fromKeychain = await readKeychainSecret({ service: 'cursor-access-token', account: 'cursor-user' })
  if (fromKeychain !== undefined) return fromKeychain
  try {
    const parsed = fileAuthSchema.safeParse(JSON.parse(await readFile(join(homedir(), '.config', 'cursor', 'auth.json'), 'utf8')))
    return parsed.success ? parsed.data.accessToken : undefined
  } catch {
    return undefined
  }
}

const planSchema = z.object({
  enabled: z.boolean().optional(),
  used: z.number().finite().optional(),
  limit: z.number().finite().optional(),
  totalPercentUsed: z.number().finite().optional(),
})

const cursorUsageSchema = z.object({
  billingCycleEnd: z.string().optional(),
  membershipType: z.string().optional(),
  individualUsage: z.object({ plan: planSchema.optional() }).optional(),
})

export class CursorAccountModel {
  /** The dashboard cookie pairs the JWT subject's user id with the token. */
  static cursorSessionCookie = (token: string): string | undefined => {
    const parsedSubject = z.string().min(1).safeParse(decodeJwtPayload(token)?.sub)
    if (!parsedSubject.success) return undefined
    const subject = parsedSubject.data
    const userId = subject.includes('|') ? subject.slice(subject.lastIndexOf('|') + 1) : subject
    return `WorkosCursorSessionToken=${encodeURIComponent(`${userId}::${token}`)}`
  }

  static parseCursorUsage = (raw: JsonValue): UsageCard => {
    const parsed = cursorUsageSchema.safeParse(raw)
    if (!parsed.success) return ProviderUsageModel.emptyUsage('unsupported', 'Cursor answered in a shape this plugin does not recognise.')
    const plan = parsed.data.individualUsage?.plan
    const usedPercent =
      plan?.totalPercentUsed ?? (plan?.used !== undefined && plan.limit !== undefined && plan.limit > 0 ? (plan.used / plan.limit) * 100 : undefined)
    const resetsAt = parsed.data.billingCycleEnd === undefined ? Number.NaN : Date.parse(parsed.data.billingCycleEnd)
    if (usedPercent === undefined) {
      return {
        ...ProviderUsageModel.emptyUsage('unsupported', 'Cursor reported no included-usage limit for this plan.'),
        plan: parsed.data.membershipType ?? null,
      }
    }
    return {
      status: 'ok',
      message: null,
      identity: null,
      plan: parsed.data.membershipType ?? null,
      windows: [
        { label: 'Monthly limit', percentRemaining: ProviderUsageModel.remainingFromUsed(usedPercent), resetsAt: Number.isNaN(resetsAt) ? null : resetsAt },
      ],
      bankedResets: 0,
      bankedResetExpiries: [],
    }
  }
}

export const readCursorUsage = async (keyEnv: string, signal?: AbortSignal, resolveCredential?: CredentialValueResolver): Promise<UsageCard> => {
  if (signal?.aborted) return ProviderUsageModel.emptyUsage('error', 'Usage collection was cancelled.')
  const token = await readCursorToken(keyEnv, resolveCredential)
  if (token === undefined) return ProviderUsageModel.emptyUsage('unauthenticated', `Sign in with ${CURSOR_LOGIN_HINT}.`)
  const cookie = CursorAccountModel.cursorSessionCookie(token)
  if (cookie === undefined)
    return ProviderUsageModel.emptyUsage('unsupported', 'This Cursor token does not identify a user, so its dashboard usage cannot be read.')
  try {
    const response = await fetch(CURSOR_USAGE_URL, {
      headers: { cookie, accept: 'application/json' },
      redirect: 'error',
      signal: ProviderUsageModel.usageSignal(signal),
    })
    if (response.status === 401 || response.status === 403)
      return ProviderUsageModel.emptyUsage('unauthenticated', `Cursor rejected this login; run ${CURSOR_LOGIN_HINT}.`)
    if (!response.ok) return ProviderUsageModel.emptyUsage('error', `Cursor returned ${String(response.status)} for usage.`)
    return CursorAccountModel.parseCursorUsage(await response.json())
  } catch (cause) {
    return ProviderUsageModel.emptyUsage('error', cause instanceof Error ? cause.message : 'Cursor usage could not be read.')
  }
}
