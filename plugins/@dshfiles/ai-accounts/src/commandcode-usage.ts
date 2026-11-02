import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as Schema from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import type { UsageCard } from './api.js'
import { CommandCodeProviderModel, DEFAULT_COMMANDCODE_KEY_ENV } from './commandcode-provider.js'
import { CredentialModel, type CredentialValueResolver } from './credentials.js'
import { AiAccountsSchema } from './effect-schema.js'
import { ProviderUsageModel, type UsageWindow } from './usage.js'
import { providerFetch } from './provider-request.js'

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

const credentialRecordSchema = Schema.Struct({
  type: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  access: Schema.optional(Schema.String),
})

type CredentialRecord = typeof credentialRecordSchema.Type

const commandCodeKeySchema = Schema.String.pipe(
  Schema.decodeTo(Schema.Struct({ kind: Schema.Literal('key'), key: Schema.String }), {
    decode: SchemaGetter.transform((key: string) => ({ kind: 'key' as const, key })),
    encode: SchemaGetter.transform(value => value.key),
  }),
)
const commandCodeRecordSchema = credentialRecordSchema.pipe(
  Schema.decodeTo(Schema.Struct({ kind: Schema.Literal('record'), record: credentialRecordSchema }), {
    decode: SchemaGetter.transform((record: CredentialRecord) => ({ kind: 'record' as const, record })),
    encode: SchemaGetter.transform(value => value.record),
  }),
)

const authFileSchema = Schema.Struct({
  apiKey: Schema.optional(Schema.String),
  commandcode: Schema.optional(Schema.Union([commandCodeKeySchema, commandCodeRecordSchema])),
  'command-code': Schema.optional(credentialRecordSchema),
})

const keyFromRecord = (record: CredentialRecord | undefined): string | undefined =>
  record === undefined ? undefined : record.type === 'oauth' ? record.access : (record.key ?? record.access)

export const readCommandCodeKey = async (keyEnv: string, resolveCredential?: CredentialValueResolver, authSource?: 'cli' | 'reference'): Promise<string> => {
  const name = keyEnv.trim() === '' ? DEFAULT_COMMANDCODE_KEY_ENV : keyEnv
  const named = authSource === 'cli' ? '' : resolveCredential === undefined ? CredentialModel.readKeyFromEnv(name) : await resolveCredential(name)
  if (named.length > 0) return named
  if (authSource === 'reference') return ''
  try {
    const parsed = AiAccountsSchema.decodeResult(authFileSchema, JSON.parse(await readFile(join(homedir(), '.commandcode', 'auth.json'), 'utf8')))
    if (parsed._tag === 'Failure') return ''
    const commandcode = parsed.success.commandcode
    const direct = commandcode?.kind === 'key' ? commandcode.key : undefined
    return (
      parsed.success.apiKey ??
      direct ??
      keyFromRecord(commandcode?.kind === 'record' ? commandcode.record : undefined) ??
      keyFromRecord(parsed.success['command-code']) ??
      ''
    ).trim()
  } catch {
    return ''
  }
}

const finiteNumber = Schema.Number.check(Schema.isFinite())

const windowLimitSchema = Schema.Struct({
  used: Schema.optional(finiteNumber),
  cap: Schema.optional(finiteNumber),
  exceeded: Schema.optional(Schema.Boolean),
  resetAt: Schema.optional(finiteNumber),
})

const creditsSchema = Schema.Struct({
  windowLimits: Schema.optional(
    Schema.NullOr(Schema.Struct({ fiveHour: Schema.optional(Schema.NullOr(windowLimitSchema)), weekly: Schema.optional(Schema.NullOr(windowLimitSchema)) })),
  ),
  credits: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        planId: Schema.optional(Schema.NullOr(Schema.String)),
        monthlyCredits: Schema.optional(Schema.NullOr(finiteNumber)),
        purchasedCredits: Schema.optional(Schema.NullOr(finiteNumber)),
        freeCredits: Schema.optional(Schema.NullOr(finiteNumber)),
      }),
    ),
  ),
})

const whoamiSchema = Schema.Struct({
  user: Schema.optional(Schema.NullOr(Schema.Struct({ userName: Schema.optional(Schema.String), name: Schema.optional(Schema.String) }))),
})

const subscriptionSchema = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        planId: Schema.optional(Schema.NullOr(Schema.String)),
        status: Schema.optional(Schema.NullOr(Schema.String)),
        currentPeriodEnd: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
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

const percentLeft = (limit: typeof windowLimitSchema.Type): number => {
  if (limit.exceeded === true) return 0
  if (limit.cap === undefined || limit.cap <= 0) return 100
  return Math.max(0, Math.min(100, Math.round((1 - (limit.used ?? 0) / limit.cap) * 1000) / 10))
}

export class CommandCodeUsageModel {
  static parseUsage = (input: { readonly credits: JsonValue; readonly whoami: JsonValue; readonly subscription: JsonValue }): UsageCard => {
    const credits = AiAccountsSchema.decodeResult(creditsSchema, input.credits)
    if (credits._tag === 'Failure') return ProviderUsageModel.emptyUsage('error', 'Command Code returned an unsupported billing response.')
    const windows: UsageWindow[] = []
    for (const [key, label] of [
      ['fiveHour', 'Current session'],
      ['weekly', 'Weekly limit'],
    ] as const) {
      const limit = credits.success.windowLimits?.[key]
      if (limit === undefined || limit === null) continue
      windows.push({ label, percentRemaining: percentLeft(limit), resetsAt: limit.resetAt === undefined || limit.resetAt <= 0 ? null : limit.resetAt })
    }
    const whoami = AiAccountsSchema.decodeResult(whoamiSchema, input.whoami)
    const subscription = AiAccountsSchema.decodeResult(subscriptionSchema, input.subscription)
    const user = whoami._tag === 'Success' ? whoami.success.user : undefined
    const plan = (subscription._tag === 'Success' ? subscription.success.data?.planId : undefined) ?? credits.success.credits?.planId ?? null
    const allowance = plan === null ? undefined : monthlyAllowance(plan)
    const monthly = credits.success.credits?.monthlyCredits
    if (allowance !== undefined && monthly !== undefined && monthly !== null) {
      const remaining = Math.max(0, monthly)
      const spendable = remaining + Math.max(0, credits.success.credits?.purchasedCredits ?? 0) + Math.max(0, credits.success.credits?.freeCredits ?? 0)
      const periodEnd = subscription._tag === 'Success' ? Date.parse(subscription.success.data?.currentPeriodEnd ?? '') : Number.NaN
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
  input: {
    readonly keyEnv: string
    readonly apiBaseUrl: string
    readonly resolveCredential?: CredentialValueResolver | undefined
    readonly onAuthenticated?: (() => void) | undefined
    readonly authSource?: 'cli' | 'reference' | undefined
  },
  signal?: AbortSignal,
): Promise<UsageCard> => {
  if (signal?.aborted) return ProviderUsageModel.emptyUsage('error', 'Usage collection was cancelled.')
  const key = await readCommandCodeKey(input.keyEnv, input.resolveCredential, input.authSource)
  if (key.length === 0) return ProviderUsageModel.emptyUsage('unauthenticated', 'Export the account key variable or run `cmd login`.')
  let base: string
  try {
    base = CommandCodeProviderModel.resolveBase(input.apiBaseUrl)
  } catch (cause) {
    return ProviderUsageModel.emptyUsage('error', cause instanceof Error ? cause.message : 'Invalid Command Code base.')
  }
  const headers = { ...COMMAND_CODE_HEADERS, authorization: `Bearer ${key}` }
  const getJson = async (path: string): Promise<{ readonly status: number; readonly body: JsonValue }> => {
    const response = await providerFetch({
      provider: 'commandcode',
      operation: 'usage',
      url: `${base}${path}`,
      init: { headers, redirect: 'error', signal: ProviderUsageModel.usageSignal(signal) },
    })
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
    const billing = AiAccountsSchema.decodeResult(creditsSchema, credits.body)
    const identity = AiAccountsSchema.decodeResult(whoamiSchema, whoami.body)
    const entitlement = AiAccountsSchema.decodeResult(subscriptionSchema, subscription.body)
    if (billing._tag === 'Success') {
      const limits = billing.success.windowLimits
      const balance = billing.success.credits
      const positive =
        limits === null ||
        balance === null ||
        [limits?.fiveHour, limits?.weekly].some(
          limit => limit === null || limit?.used !== undefined || limit?.cap !== undefined || limit?.exceeded !== undefined,
        ) ||
        balance?.planId?.trim() ||
        balance?.monthlyCredits !== undefined ||
        balance?.purchasedCredits !== undefined ||
        balance?.freeCredits !== undefined ||
        (identity._tag === 'Success' && (identity.success.user?.userName?.trim() || identity.success.user?.name?.trim())) ||
        (entitlement._tag === 'Success' && entitlement.success.data?.planId?.trim())
      if (positive && !signal?.aborted) input.onAuthenticated?.()
    }
    return CommandCodeUsageModel.parseUsage({ credits: credits.body, whoami: whoami.body, subscription: subscription.body })
  } catch (cause) {
    return ProviderUsageModel.emptyUsage('error', cause instanceof Error ? cause.message : 'Command Code usage could not be read.')
  }
}
