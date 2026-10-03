import { readFile } from 'node:fs/promises'
import { readCodexResetCredits } from './codex-reset-credits.js'
import { join } from 'node:path'
import { z } from 'zod'

/**
 * Subscription usage for one account.
 *
 * Both providers answer a windowed quota rather than a spend figure: Codex
 * reports a 5-hour and a weekly window, OpenCode Go a rolling, weekly and monthly
 * one. Each window is read as percent *remaining* with a reset time, which is
 * what a card can show without inventing a currency.
 *
 * Requests use each account's own credential and stay bounded by a short
 * timeout, so a slow or unreachable provider degrades one card rather than the
 * panel. Nothing here stores or logs a token.
 */

export const usageWindowSchema = z.object({
  /** Percent of the window still available. */
  percentRemaining: z.number(),
  /** Epoch milliseconds when the window resets. */
  resetsAt: z.number().nullable(),
})

export const usageCardSchema = z.object({
  /** `ok`, `unauthenticated`, `unsupported`, `rate-limited`, or `error`. */
  status: z.enum(['ok', 'unauthenticated', 'unsupported', 'rate-limited', 'error']),
  message: z.string().max(300).nullable(),
  identity: z.string().max(320).nullable(),
  plan: z.string().max(64).nullable(),
  windows: z.array(usageWindowSchema.extend({ label: z.string().max(32) })).max(6),
  /** Windows the provider banked for later, when it reports them. */
  bankedResets: z.number().int().min(0).max(20),
  bankedResetExpiries: z.array(z.number().nullable()).max(20),
})

export type UsageWindow = z.infer<typeof usageWindowSchema>
export type UsageCard = z.infer<typeof usageCardSchema>

const error = (message: string): UsageCard => ({
  status: 'error',
  message,
  identity: null,
  plan: null,
  windows: [],
  bankedResets: 0,
  bankedResetExpiries: [],
})

const empty = (
  status: UsageCard['status'],
  message: string | null = null,
): UsageCard => ({
  status,
  message,
  identity: null,
  plan: null,
  windows: [],
  bankedResets: 0,
  bankedResetExpiries: [],
})

/** Codex answers in its own wire shape; map it onto our window model. */
const codexWindowSchema = z.object({
    used_percent: z.number().finite().optional(),
    limit_window_seconds: z.number().positive().optional(),
    reset_at: z.number().finite().optional(),
    resets_at: z.number().finite().optional(),
  })


const codexUsageSchema = z.object({
    plan_type: z.string().optional(),
    rate_limit: z.object({
        primary_window: codexWindowSchema.optional(),
        secondary_window: codexWindowSchema.optional(),
      })
    
      .optional(),
    // Codex reports credits and reset banking alongside the windows.
    credits: z.object({}).loose().optional(),
  })


const codexAuthSchema = z.object({
    tokens: z.object({
        access_token: z.string().min(1),
        account_id: z.string().optional(),
        id_token: z.string().optional(),
      })
    ,
  })


/** Percent remaining, clamped, from Codex's percent-used. */
const remainingFrom = (usedPercent: number | undefined): number | null => {
  if (usedPercent === undefined) return null
  return Math.max(0, Math.min(100, Math.round((100 - usedPercent) * 10) / 10))
}

const resetAtFrom = (window: z.infer<typeof codexWindowSchema>): number | null => {
  const absolute = window.reset_at ?? window.resets_at
  if (absolute !== undefined) {
    // Codex reports seconds on some responses and milliseconds on others.
    return absolute > 1e12 ? absolute : absolute * 1000
  }
  return null
}

/** Read one Codex account's live quota using the credential in its own home. */
export const readCodexUsage = async (codexHome: string): Promise<UsageCard> => {
  const credits = await readCodexResetCredits(codexHome)
  let auth: z.infer<typeof codexAuthSchema>
  try {
    auth = codexAuthSchema.parse(JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8')))
  } catch {
    return empty('unauthenticated')
  }

  const accountId = auth.tokens.account_id
  if (accountId === undefined) {
    return error('The Codex account identifier was not found in its sign-in data.')
  }

  try {
    const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: {
        authorization: `Bearer ${auth.tokens.access_token}`,
        'chatgpt-account-id': accountId,
        accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return error(`Codex returned ${String(response.status)} for usage.`)
    const body = codexUsageSchema.parse(await response.json())

    const windows: (UsageWindow & { label: string })[] = []
    const primary = body.rate_limit?.primary_window
    const secondary = body.rate_limit?.secondary_window
    const shortRemaining = remainingFrom(primary?.used_percent)
    if (shortRemaining !== null) {
      windows.push({
        label: 'Current session',
        percentRemaining: shortRemaining,
        resetsAt: resetAtFrom(primary ?? {}),
      })
    }
    const weeklyRemaining = remainingFrom(secondary?.used_percent)
    if (weeklyRemaining !== null) {
      windows.push({
        label: 'Weekly limit',
        percentRemaining: weeklyRemaining,
        resetsAt: resetAtFrom(secondary ?? {}),
      })
    }
    if (windows.length === 0 && credits.available === 0) return empty('ok')

    return {
      status: 'ok',
      message: null,
      identity: null,
      plan: body.plan_type ?? null,
      windows,
      bankedResets: credits.available,
      bankedResetExpiries: credits.resets.map(reset => reset.expiresAt ?? null),
    }
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : 'Codex usage could not be read.')
  }
}

const opencodeWindowSchema = z.object({
    status: z.enum(['ok', 'rate-limited']),
    percent: z.number().finite().min(0).max(100),
    resetsAt: z.string().datetime().optional(),
  })


const opencodeUsageSchema = z.object({
    usage: z.object({
        rolling: opencodeWindowSchema.optional(),
        weekly: opencodeWindowSchema.optional(),
        monthly: opencodeWindowSchema.optional(),
      })
    ,
  })


const OPENCODE_WINDOW_LABELS: Readonly<Record<'rolling' | 'weekly' | 'monthly', string>> = {
  rolling: 'Current session',
  weekly: 'Weekly limit',
  monthly: 'Monthly limit',
}

/** Read OpenCode Go's live quota with the key the account names. */
export const readOpenCodeUsage = async (apiKey: string): Promise<UsageCard> => {
  if (apiKey.trim().length === 0) return empty('unauthenticated')
  try {
    const response = await fetch('https://opencode.ai/zen/go/v1/usage', {
      headers: { authorization: `Bearer ${apiKey.trim()}`, accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return error(`OpenCode returned ${String(response.status)} for usage.`)
    const body = opencodeUsageSchema.parse(await response.json())

    const windows: (UsageWindow & { label: string })[] = []
    for (const [key, label] of Object.entries(OPENCODE_WINDOW_LABELS) as [
      'rolling' | 'weekly' | 'monthly',
      string,
    ][]) {
      const window = body.usage[key]
      if (window === undefined) continue
      windows.push({
        label,
        percentRemaining: window.percent,
        resetsAt: window.resetsAt === undefined ? null : Date.parse(window.resetsAt),
      })
    }
    if (windows.length === 0) return empty('ok')

    return {
      status: 'ok',
      message: null,
      identity: null,
      plan: null,
      windows,
      bankedResets: 0,
      bankedResetExpiries: [],
    }
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : 'OpenCode usage could not be read.')
  }
}