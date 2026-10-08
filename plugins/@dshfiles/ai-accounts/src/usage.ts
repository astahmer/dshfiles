import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { UsageCard } from './api.js'
import { readCodexResetCredits, type CodexResetCredits } from './codex-reset-credits.js'
import { decodeJwtPayload } from './codex-home.js'

/**
 * Subscription usage for one account.
 *
 * Every provider answers a windowed quota rather than a spend figure. Each
 * window is read as percent *remaining* with a reset time, which is what a card
 * can show without inventing a currency.
 *
 * Requests use each account's own credential and stay bounded by a short
 * timeout, so a slow or unreachable provider degrades one card rather than the
 * panel. Nothing here stores or logs a token.
 */

export type UsageWindow = UsageCard['windows'][number]

const READ_TIMEOUT_MS = 5_000

export const usageSignal = (signal: AbortSignal | undefined): AbortSignal =>
  signal === undefined ? AbortSignal.timeout(READ_TIMEOUT_MS) : AbortSignal.any([signal, AbortSignal.timeout(READ_TIMEOUT_MS)])

export const emptyUsage = (status: UsageCard['status'], message: string | null = null): UsageCard => ({
  status,
  message,
  identity: null,
  plan: null,
  windows: [],
  bankedResets: 0,
  bankedResetExpiries: [],
})

/** Percent remaining, clamped to one decimal, from a percent used. */
export const remainingFromUsed = (usedPercent: number): number => Math.max(0, Math.min(100, Math.round((100 - usedPercent) * 10) / 10))

const codexWindowSchema = z.object({
  used_percent: z.number().finite(),
  limit_window_seconds: z.number().positive().optional(),
  reset_after_seconds: z.number().finite().nonnegative().optional(),
  reset_at: z.number().finite().optional(),
  resets_at: z.number().finite().optional(),
})

const codexUsageSchema = z.object({
  plan_type: z.string().optional(),
  rate_limit: z
    .object({
      primary_window: codexWindowSchema.nullish(),
      secondary_window: codexWindowSchema.nullish(),
    })
    .nullish(),
})

const codexAuthSchema = z.object({
  tokens: z.object({
    access_token: z.string().min(1),
    account_id: z.string().optional(),
    id_token: z.string().optional(),
  }),
})

/**
 * The window's span decides its label, not its position: a free plan reports
 * its weekly window as the primary one.
 */
const codexWindowLabel = (seconds: number | undefined, position: 'primary' | 'secondary'): string => {
  if (seconds === undefined) return position === 'primary' ? 'Current session' : 'Weekly limit'
  const minutes = seconds / 60
  if (minutes < 1_440) return 'Current session'
  if (minutes <= 10_080) return 'Weekly limit'
  return 'Monthly limit'
}

const codexResetAt = (window: z.infer<typeof codexWindowSchema>, now: number): number | null => {
  const absolute = window.reset_at ?? window.resets_at
  // Codex reports seconds on some responses and milliseconds on others.
  if (absolute !== undefined && absolute > 0) return absolute > 1e12 ? absolute : absolute * 1000
  if (window.reset_after_seconds !== undefined) return now + window.reset_after_seconds * 1000
  return null
}

export const parseCodexUsage = (raw: unknown, credits: CodexResetCredits, now: number): UsageCard => {
  const parsed = codexUsageSchema.safeParse(raw)
  if (!parsed.success) return emptyUsage('error', 'Codex returned an unsupported usage response.')
  const windows: UsageWindow[] = []
  for (const position of ['primary', 'secondary'] as const) {
    const window = parsed.data.rate_limit?.[`${position}_window`]
    if (window === undefined || window === null) continue
    windows.push({
      label: codexWindowLabel(window.limit_window_seconds, position),
      percentRemaining: remainingFromUsed(window.used_percent),
      resetsAt: codexResetAt(window, now),
    })
  }
  return {
    status: 'ok',
    message: null,
    identity: null,
    plan: parsed.data.plan_type ?? null,
    windows,
    bankedResets: credits.available,
    bankedResetExpiries: credits.resets.map(reset => reset.expiresAt ?? null),
  }
}

/** Read one Codex account's live quota using the credential in its own home. */
export const readCodexUsage = async (codexHome: string, signal?: AbortSignal): Promise<UsageCard> => {
  if (signal?.aborted) return emptyUsage('error', 'Usage collection was cancelled.')
  let auth: z.infer<typeof codexAuthSchema>
  try {
    auth = codexAuthSchema.parse(JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8')))
  } catch {
    return emptyUsage('unauthenticated')
  }
  const claims = auth.tokens.id_token === undefined ? undefined : decodeJwtPayload(auth.tokens.id_token)
  const authClaims = z.object({ chatgpt_account_id: z.string().optional() }).safeParse(claims?.['https://api.openai.com/auth'])
  const accountId = auth.tokens.account_id ?? (authClaims.success ? authClaims.data.chatgpt_account_id : undefined)
  if (accountId === undefined) return emptyUsage('error', 'The Codex account identifier was not found in its sign-in data.')

  try {
    const [credits, response] = await Promise.all([
      readCodexResetCredits(codexHome, signal),
      fetch('https://chatgpt.com/backend-api/wham/usage', {
        headers: {
          authorization: `Bearer ${auth.tokens.access_token}`,
          'chatgpt-account-id': accountId,
          accept: 'application/json',
        },
        redirect: 'error',
        signal: usageSignal(signal),
      }),
    ])
    if (response.status === 401 || response.status === 403) return emptyUsage('unauthenticated', 'Codex rejected this login; sign in again.')
    if (!response.ok) return emptyUsage('error', `Codex returned ${String(response.status)} for usage.`)
    return parseCodexUsage(await response.json(), credits, Date.now())
  } catch (cause) {
    return emptyUsage('error', cause instanceof Error ? cause.message : 'Codex usage could not be read.')
  }
}

const opencodeWindowSchema = z.object({
  status: z.enum(['ok', 'rate-limited']),
  /** Percent *used*, which the reference reader shows as `100 - percent` left. */
  percent: z.number().finite().min(0).max(100),
  resetsAt: z.string().datetime().optional(),
})

const opencodeUsageSchema = z.object({
  usage: z.object({
    rolling: opencodeWindowSchema.optional(),
    weekly: opencodeWindowSchema.optional(),
    monthly: opencodeWindowSchema.optional(),
  }),
})

const OPENCODE_WINDOWS = [
  ['rolling', 'Current session'],
  ['weekly', 'Weekly limit'],
  ['monthly', 'Monthly limit'],
] as const

export const parseOpenCodeUsage = (raw: unknown): UsageCard => {
  const parsed = opencodeUsageSchema.safeParse(raw)
  if (!parsed.success) return emptyUsage('error', 'OpenCode returned an unsupported usage response.')
  const windows: UsageWindow[] = []
  for (const [key, label] of OPENCODE_WINDOWS) {
    const window = parsed.data.usage[key]
    if (window === undefined) continue
    windows.push({
      label,
      percentRemaining: window.status === 'rate-limited' ? 0 : remainingFromUsed(window.percent),
      resetsAt: window.resetsAt === undefined ? null : Date.parse(window.resetsAt),
    })
  }
  return { status: 'ok', message: null, identity: null, plan: null, windows, bankedResets: 0, bankedResetExpiries: [] }
}

/** Read OpenCode Go's live quota with the key the account names. */
export const readOpenCodeUsage = async (apiKey: string, signal?: AbortSignal): Promise<UsageCard> => {
  if (apiKey.trim().length === 0) return emptyUsage('unauthenticated')
  if (signal?.aborted) return emptyUsage('error', 'Usage collection was cancelled.')
  try {
    const response = await fetch('https://opencode.ai/zen/go/v1/usage', {
      headers: { authorization: `Bearer ${apiKey.trim()}`, accept: 'application/json' },
      signal: usageSignal(signal),
    })
    if (response.status === 401 || response.status === 403) return emptyUsage('unauthenticated', 'OpenCode rejected this key.')
    if (!response.ok) return emptyUsage('error', `OpenCode returned ${String(response.status)} for usage.`)
    return parseOpenCodeUsage(await response.json())
  } catch (cause) {
    return emptyUsage('error', cause instanceof Error ? cause.message : 'OpenCode usage could not be read.')
  }
}
