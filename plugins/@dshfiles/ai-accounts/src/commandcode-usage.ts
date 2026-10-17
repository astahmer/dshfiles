import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { UsageCard } from './api.js'
import { CommandCodeProviderModel, DEFAULT_COMMANDCODE_KEY_ENV } from './commandcode-provider.js'
import { CredentialModel, type CredentialValueResolver } from './credentials.js'
import { ProviderUsageModel, type UsageWindow } from './usage.js'

type JsonValue = string | number | boolean | null | undefined | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/**
 * Command Code subscription quota.
 *
 * The same account endpoints the official CLI reads: `/alpha/billing/credits`
 * carries the five-hour and weekly window limits as `used`/`cap` with a
 * millisecond `resetAt` plus the remaining monthly, purchased and free credits,
 * `/alpha/whoami` the user, and `/alpha/billing/subscriptions` the plan and its
 * billing period. The key comes from the account's variable, falling back to
 * the file `cmd login` writes.
 */

const credentialRecordSchema = z.object({ type: z.string().optional(), key: z.string().optional(), access: z.string().optional() })

type CommandCodeAuthValue =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'record'; readonly record: z.infer<typeof credentialRecordSchema> }

const commandCodeKeySchema = z.string().transform((key): CommandCodeAuthValue => ({ kind: 'key', key }))
const commandCodeRecordSchema = credentialRecordSchema.transform((record): CommandCodeAuthValue => ({ kind: 'record', record }))

const authFileSchema = z.object({
  apiKey: z.string().optional(),
  commandcode: z.union([commandCodeKeySchema, commandCodeRecordSchema]).optional(),
  'command-code': credentialRecordSchema.optional(),
})

const keyFromRecord = (record: z.infer<typeof credentialRecordSchema> | undefined): string | undefined =>
  record === undefined ? undefined : record.type === 'oauth' ? record.access : (record.key ?? record.access)

export const readCommandCodeKey = async (keyEnv: string, resolveCredential?: CredentialValueResolver): Promise<string> => {
  const name = keyEnv.trim() === '' ? DEFAULT_COMMANDCODE_KEY_ENV : keyEnv
  const named = resolveCredential === undefined ? CredentialModel.readKeyFromEnv(name) : await resolveCredential(name)
  if (named.length > 0) return named
  try {
    const parsed = authFileSchema.safeParse(JSON.parse(await readFile(join(homedir(), '.commandcode', 'auth.json'), 'utf8')))
    if (!parsed.success) return ''
    const commandcode = parsed.data.commandcode
    const direct = commandcode?.kind === 'key' ? commandcode.key : undefined
    return (
      parsed.data.apiKey ??
      direct ??
      keyFromRecord(commandcode?.kind === 'record' ? commandcode.record : undefined) ??
      keyFromRecord(parsed.data['command-code']) ??
      ''
    ).trim()
  } catch {
    return ''
  }
}

const windowLimitSchema = z.object({
  used: z.number().finite().optional(),
  cap: z.number().finite().optional(),
  exceeded: z.boolean().optional(),
  resetAt: z.number().finite().optional(),
})

const creditsSchema = z.object({
  windowLimits: z.object({ fiveHour: windowLimitSchema.nullish(), weekly: windowLimitSchema.nullish() }).nullish(),
  credits: z
    .object({
      planId: z.string().nullish(),
      monthlyCredits: z.number().finite().nullish(),
      purchasedCredits: z.number().finite().nullish(),
      freeCredits: z.number().finite().nullish(),
    })
    .nullish(),
})

const whoamiSchema = z.object({ user: z.object({ userName: z.string().optional(), name: z.string().optional() }).nullish() })

const subscriptionSchema = z.object({
  data: z.object({ planId: z.string().nullish(), status: z.string().nullish(), currentPeriodEnd: z.string().nullish() }).nullish(),
})

/** Monthly credit allowance per plan, as the official CLI 1.38.2 ships it; plan ids carry suffixes such as `-v1`. */
const PLAN_MONTHLY_CREDITS: ReadonlyArray<readonly [string, number]> = [
  ['individual-goat', 70],
  ['individual-go', 10],
  ['individual-pro-v1', 80],
  ['individual-provider', 15],
  ['individual-pro', 30],
  ['individual-max', 150],
  ['individual-ultra', 300],
  ['teams-pro', 40],
]

/** Command Code refused every model with 0.098 credits left on a Go plan, so a balance under this cannot serve a turn. */
const MIN_SPENDABLE_CREDITS = 0.25

const monthlyAllowance = (planId: string): number | undefined =>
  PLAN_MONTHLY_CREDITS.filter(([prefix]) => planId === prefix || planId.startsWith(`${prefix}-`)).sort(([left], [right]) => right.length - left.length)[0]?.[1]

const percentLeft = (limit: z.infer<typeof windowLimitSchema>): number => {
  if (limit.exceeded === true) return 0
  if (limit.cap === undefined || limit.cap <= 0) return 100
  return Math.max(0, Math.min(100, Math.round((1 - (limit.used ?? 0) / limit.cap) * 1000) / 10))
}

export class CommandCodeUsageModel {
  static parseUsage = (input: { readonly credits: JsonValue; readonly whoami: JsonValue; readonly subscription: JsonValue }): UsageCard => {
    const credits = creditsSchema.safeParse(input.credits)
    if (!credits.success) return ProviderUsageModel.emptyUsage('error', 'Command Code returned an unsupported billing response.')
    const windows: UsageWindow[] = []
    for (const [key, label] of [
      ['fiveHour', 'Current session'],
      ['weekly', 'Weekly limit'],
    ] as const) {
      const limit = credits.data.windowLimits?.[key]
      if (limit === undefined || limit === null) continue
      windows.push({ label, percentRemaining: percentLeft(limit), resetsAt: limit.resetAt === undefined || limit.resetAt <= 0 ? null : limit.resetAt })
    }
    const whoami = whoamiSchema.safeParse(input.whoami)
    const subscription = subscriptionSchema.safeParse(input.subscription)
    const user = whoami.success ? whoami.data.user : undefined
    const plan = (subscription.success ? subscription.data.data?.planId : undefined) ?? credits.data.credits?.planId ?? null
    const allowance = plan === null ? undefined : monthlyAllowance(plan)
    const monthly = credits.data.credits?.monthlyCredits
    if (allowance !== undefined && monthly !== undefined && monthly !== null) {
      const remaining = Math.max(0, monthly)
      const spendable = remaining + Math.max(0, credits.data.credits?.purchasedCredits ?? 0) + Math.max(0, credits.data.credits?.freeCredits ?? 0)
      const periodEnd = subscription.success ? Date.parse(subscription.data.data?.currentPeriodEnd ?? '') : Number.NaN
      windows.push({
        label: 'Monthly limit',
        percentRemaining: spendable < MIN_SPENDABLE_CREDITS ? 0 : Math.min(100, Math.round((remaining / allowance) * 1000) / 10),
        resetsAt: Number.isFinite(periodEnd) ? periodEnd : null,
      })
    }
    return {
      status: windows.length === 0 ? 'unsupported' : 'ok',
      message: windows.length === 0 ? 'Command Code reported no window limits for this plan.' : null,
      identity: user?.userName ?? user?.name ?? null,
      plan,
      windows,
      bankedResets: 0,
      bankedResetExpiries: [],
    }
  }
}

const COMMAND_CODE_HEADERS = { 'accept-encoding': 'identity', 'x-cli-environment': 'production', accept: 'application/json' }

export const readCommandCodeUsage = async (
  input: { readonly keyEnv: string; readonly apiBaseUrl: string; readonly resolveCredential?: CredentialValueResolver | undefined },
  signal?: AbortSignal,
): Promise<UsageCard> => {
  if (signal?.aborted) return ProviderUsageModel.emptyUsage('error', 'Usage collection was cancelled.')
  const key = await readCommandCodeKey(input.keyEnv, input.resolveCredential)
  if (key.length === 0) return ProviderUsageModel.emptyUsage('unauthenticated', 'Export the account key variable or run `cmd login`.')
  let base: string
  try {
    base = CommandCodeProviderModel.resolveBase(input.apiBaseUrl)
  } catch (cause) {
    return ProviderUsageModel.emptyUsage('error', cause instanceof Error ? cause.message : 'Invalid Command Code base.')
  }
  const headers = { ...COMMAND_CODE_HEADERS, authorization: `Bearer ${key}` }
  const getJson = async (path: string): Promise<{ readonly status: number; readonly body: JsonValue }> => {
    const response = await fetch(`${base}${path}`, { headers, redirect: 'error', signal: ProviderUsageModel.usageSignal(signal) })
    return { status: response.status, body: response.ok ? await response.json() : undefined }
  }
  try {
    const [credits, whoami, subscription] = await Promise.all([
      getJson('/alpha/billing/credits'),
      getJson('/alpha/whoami').catch(() => ({ status: 0, body: undefined })),
      getJson('/alpha/billing/subscriptions').catch(() => ({ status: 0, body: undefined })),
    ])
    if (credits.status === 401 || credits.status === 403) return ProviderUsageModel.emptyUsage('unauthenticated', 'Command Code rejected this key.')
    if (credits.body === undefined) return ProviderUsageModel.emptyUsage('error', `Command Code returned ${String(credits.status)} for billing.`)
    return CommandCodeUsageModel.parseUsage({ credits: credits.body, whoami: whoami.body, subscription: subscription.body })
  } catch (cause) {
    return ProviderUsageModel.emptyUsage('error', cause instanceof Error ? cause.message : 'Command Code usage could not be read.')
  }
}
