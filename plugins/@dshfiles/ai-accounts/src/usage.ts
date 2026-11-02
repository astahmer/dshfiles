import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import type { UsageCard } from './api.js'
import { readCodexResetCredits, type CodexResetCredits } from './codex-reset-credits.js'
import { CodexHomeModel } from './codex-home.js'
import { AiAccountsSchema } from './effect-schema.js'
import { providerFetch } from './provider-request.js'

type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

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

const finiteNumber = Schema.Number.check(Schema.isFinite())

/** The UTC pattern the previous datetime string rule accepted, so the converted schema accepts the same values. */
const utcDateTimePattern =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$/u

const dateTimeString = Schema.String.check(
  Schema.makeFilter(value => (utcDateTimePattern.test(value) ? true : 'Invalid datetime'), {
    toJsonSchema: () => ({ format: 'date-time', pattern: utcDateTimePattern.source }),
  }),
)

const codexWindowSchema = Schema.Struct({
  used_percent: finiteNumber,
  limit_window_seconds: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))),
  reset_after_seconds: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))),
  reset_at: Schema.optional(finiteNumber),
  resets_at: Schema.optional(finiteNumber),
})

/** Nullish, as the previous contract read it: absent stays absent, `null` stays `null`, and a malformed window reads as `undefined`. */
const codexWindowNullish = Schema.optional(Schema.NullOr(codexWindowSchema)).pipe(Schema.catchDecoding(() => Effect.succeed(Option.none())))

const codexRateLimitSchema = Schema.Struct({
  primary_window: codexWindowNullish,
  secondary_window: codexWindowNullish,
})

const codexRateLimitNullish = Schema.optional(Schema.NullOr(codexRateLimitSchema)).pipe(Schema.catchDecoding(() => Effect.succeed(Option.none())))

const additionalRateLimitSchema = Schema.Struct({
  limit_name: Schema.optional(Schema.NullOr(Schema.String)),
  metered_feature: Schema.optional(Schema.NullOr(Schema.String)),
  rate_limit: codexRateLimitNullish,
})

/** A malformed entry in the list reads as `null`, the way the contract's per-entry `catch(null)` did. */
const additionalRateLimitOrNull = Schema.NullOr(additionalRateLimitSchema).pipe(Schema.catchDecoding(() => Effect.succeed(Option.some(null))))

const additionalRateLimitsNullish = Schema.optional(Schema.NullOr(Schema.Array(additionalRateLimitOrNull))).pipe(
  Schema.catchDecoding(() => Effect.succeed(Option.none())),
)

const codexUsageSchema = Schema.Struct({
  plan_type: Schema.optional(Schema.String),
  rate_limit: codexRateLimitNullish,
  /** Extra metered limits; Luna Reserve is one of them when the request asks for it. */
  additional_rate_limits: additionalRateLimitsNullish,
})

// Display parsing tolerates an unknown window; fresh authentication evidence does not silently repair malformed data.
const codexAuthenticatedSchema = Schema.Struct({
  ...codexUsageSchema.fields,
  rate_limit: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        primary_window: Schema.optional(Schema.NullOr(codexWindowSchema)),
        secondary_window: Schema.optional(Schema.NullOr(codexWindowSchema)),
      }),
    ),
  ),
})

/** Asks the usage endpoint to include the Luna Reserve meter, as the official client does. */
const LUNA_RESERVE_HEADER = 'x-openai-codex-luna-reserve'

const isReserveLimit = (name: string | null | undefined): boolean => name !== undefined && name !== null && /luna|reserve/i.test(name)

const codexAuthSchema = Schema.Struct({
  tokens: Schema.Struct({
    access_token: Schema.String.check(Schema.isMinLength(1)),
    account_id: Schema.optional(Schema.String),
    id_token: Schema.optional(Schema.String),
  }),
})

const codexAuthClaimsSchema = Schema.Struct({ chatgpt_account_id: Schema.optional(Schema.String) })

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

const codexResetAt = (window: typeof codexWindowSchema.Type, now: number): number | null => {
  const absolute = window.reset_at ?? window.resets_at
  // Codex reports seconds on some responses and milliseconds on others.
  if (absolute !== undefined && absolute > 0) return absolute > 1e12 ? absolute : absolute * 1000
  if (window.reset_after_seconds !== undefined) return now + window.reset_after_seconds * 1000
  return null
}

/** Read one Codex account's live quota using the credential in its own home. */
export const readCodexUsage = async (codexHome: string, signal?: AbortSignal, onAuthenticated?: () => void): Promise<UsageCard> => {
  if (signal?.aborted) return ProviderUsageModel.emptyUsage('error', 'Usage collection was cancelled.')
  let auth: typeof codexAuthSchema.Type
  try {
    auth = AiAccountsSchema.decode(codexAuthSchema, JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8')))
  } catch {
    return ProviderUsageModel.emptyUsage('unauthenticated')
  }
  const claims = auth.tokens.id_token === undefined ? undefined : CodexHomeModel.decodeJwtPayload(auth.tokens.id_token)
  const authClaims = AiAccountsSchema.decodeResult(codexAuthClaimsSchema, claims?.['https://api.openai.com/auth'])
  const accountId = auth.tokens.account_id ?? (authClaims._tag === 'Success' ? authClaims.success.chatgpt_account_id : undefined)
  if (accountId === undefined) return ProviderUsageModel.emptyUsage('error', 'The Codex account identifier was not found in its sign-in data.')

  try {
    const [credits, response] = await Promise.all([
      readCodexResetCredits(codexHome, signal),
      providerFetch({
        provider: 'codex',
        operation: 'usage',
        url: 'https://chatgpt.com/backend-api/wham/usage',
        init: {
          headers: {
            authorization: `Bearer ${auth.tokens.access_token}`,
            'chatgpt-account-id': accountId,
            accept: 'application/json',
            [LUNA_RESERVE_HEADER]: '1',
          },
          redirect: 'error',
          signal: ProviderUsageModel.usageSignal(signal),
        },
      }),
    ])
    if (response.status === 401 || response.status === 403) return ProviderUsageModel.emptyUsage('unauthenticated', 'Codex rejected this login; sign in again.')
    if (!response.ok) return ProviderUsageModel.emptyUsage('error', `Codex returned ${String(response.status)} for usage.`)
    const raw: JsonValue = await response.json()
    const parsed = AiAccountsSchema.decodeResult(codexAuthenticatedSchema, raw)
    if (
      parsed._tag === 'Success' &&
      (parsed.success.plan_type?.trim() ||
        parsed.success.rate_limit === null ||
        parsed.success.rate_limit?.primary_window !== undefined ||
        parsed.success.rate_limit?.secondary_window !== undefined)
    ) {
      if (!signal?.aborted) onAuthenticated?.()
    }
    return ProviderUsageModel.parseCodexUsage(raw, credits, Date.now())
  } catch (cause) {
    return ProviderUsageModel.emptyUsage('error', cause instanceof Error ? cause.message : 'Codex usage could not be read.')
  }
}

const opencodeWindowSchema = Schema.Struct({
  status: Schema.Literals(['ok', 'rate-limited']),
  /** Percent *used*, which the reference reader shows as `100 - percent` left. */
  percent: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100)),
  resetsAt: Schema.optional(dateTimeString),
})

const opencodeUsageSchema = Schema.Struct({
  usage: Schema.Struct({
    rolling: Schema.optional(Schema.NullOr(opencodeWindowSchema)),
    weekly: Schema.optional(Schema.NullOr(opencodeWindowSchema)),
    monthly: Schema.optional(Schema.NullOr(opencodeWindowSchema)),
  }),
})

const OPENCODE_WINDOWS = [
  ['rolling', 'Current session'],
  ['weekly', 'Weekly limit'],
  ['monthly', 'Monthly limit'],
] as const

/** Read OpenCode Go's live quota with the key the account names. */
export const readOpenCodeUsage = async (apiKey: string, signal?: AbortSignal, onAuthenticated?: () => void): Promise<UsageCard> => {
  if (apiKey.trim().length === 0) return ProviderUsageModel.emptyUsage('unauthenticated')
  if (signal?.aborted) return ProviderUsageModel.emptyUsage('error', 'Usage collection was cancelled.')
  try {
    const response = await providerFetch({
      provider: 'opencode',
      operation: 'usage',
      url: 'https://opencode.ai/zen/go/v1/usage',
      init: {
        headers: { authorization: `Bearer ${apiKey.trim()}`, accept: 'application/json' },
        redirect: 'error',
        signal: ProviderUsageModel.usageSignal(signal),
      },
    })
    if (response.status === 401 || response.status === 403) return ProviderUsageModel.emptyUsage('unauthenticated', 'OpenCode rejected this key.')
    if (!response.ok) return ProviderUsageModel.emptyUsage('error', `OpenCode returned ${String(response.status)} for usage.`)
    const raw: JsonValue = await response.json()
    const parsed = AiAccountsSchema.decodeResult(opencodeUsageSchema, raw)
    if (parsed._tag === 'Success' && OPENCODE_WINDOWS.some(([key]) => parsed.success.usage[key] !== undefined) && !signal?.aborted) onAuthenticated?.()
    return ProviderUsageModel.parseOpenCodeUsage(raw)
  } catch (cause) {
    return ProviderUsageModel.emptyUsage('error', cause instanceof Error ? cause.message : 'OpenCode usage could not be read.')
  }
}

export class ProviderUsageModel {
  static usageSignal = (signal: AbortSignal | undefined): AbortSignal =>
    signal === undefined ? AbortSignal.timeout(READ_TIMEOUT_MS) : AbortSignal.any([signal, AbortSignal.timeout(READ_TIMEOUT_MS)])

  static emptyUsage = (status: UsageCard['status'], message: string | null = null): UsageCard => ({
    status,
    message,
    identity: null,
    plan: null,
    windows: [],
    bankedResets: 0,
    bankedResetExpiries: [],
  })

  /** Percent remaining, clamped to one decimal, from a percent used. */
  static remainingFromUsed = (usedPercent: number): number => Math.max(0, Math.min(100, Math.round((100 - usedPercent) * 10) / 10))

  static parseCodexUsage = (raw: JsonValue, credits: CodexResetCredits, now: number): UsageCard => {
    const parsed = AiAccountsSchema.decodeResult(codexUsageSchema, raw)
    if (parsed._tag === 'Failure') return ProviderUsageModel.emptyUsage('error', 'Codex returned an unsupported usage response.')
    const windows: UsageWindow[] = []
    for (const position of ['primary', 'secondary'] as const) {
      const window = parsed.success.rate_limit?.[`${position}_window`]
      if (window === undefined || window === null) continue
      windows.push({
        label: codexWindowLabel(window.limit_window_seconds, position),
        percentRemaining: ProviderUsageModel.remainingFromUsed(window.used_percent),
        resetsAt: codexResetAt(window, now),
      })
    }
    // Reserve meters only ever add a window: the ordinary gauges above always come from `rate_limit`.
    for (const limit of parsed.success.additional_rate_limits ?? []) {
      if (limit === null || !(isReserveLimit(limit.limit_name) || isReserveLimit(limit.metered_feature))) continue
      const reserveWindows = [limit.rate_limit?.primary_window, limit.rate_limit?.secondary_window].flatMap(window =>
        window === undefined || window === null
          ? []
          : [{ percentRemaining: ProviderUsageModel.remainingFromUsed(window.used_percent), resetsAt: codexResetAt(window, now) }],
      )
      const tightest = reserveWindows.sort((left, right) => left.percentRemaining - right.percentRemaining)[0]
      if (tightest === undefined || windows.length >= 6) continue
      const name = limit.limit_name?.trim() ?? ''
      windows.push({ label: isReserveLimit(name) ? name.slice(0, 32) : 'Luna Reserve', ...tightest, reserve: true })
    }
    return {
      status: 'ok',
      message: null,
      identity: null,
      plan: parsed.success.plan_type ?? null,
      windows,
      bankedResets: credits.available,
      bankedResetExpiries: credits.resets.map(reset => reset.expiresAt ?? null),
    }
  }

  static parseOpenCodeUsage = (raw: JsonValue): UsageCard => {
    const parsed = AiAccountsSchema.decodeResult(opencodeUsageSchema, raw)
    if (parsed._tag === 'Failure') return ProviderUsageModel.emptyUsage('error', 'OpenCode returned an unsupported usage response.')
    const windows: UsageWindow[] = []
    for (const [key, label] of OPENCODE_WINDOWS) {
      const window = parsed.success.usage[key]
      if (window === undefined || window === null) continue
      windows.push({
        label,
        percentRemaining: window.status === 'rate-limited' ? 0 : ProviderUsageModel.remainingFromUsed(window.percent),
        resetsAt: window.resetsAt === undefined ? null : Date.parse(window.resetsAt),
      })
    }
    return { status: 'ok', message: null, identity: null, plan: null, windows, bankedResets: 0, bankedResetExpiries: [] }
  }
}
