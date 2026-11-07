import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import * as Schema from 'effect/Schema'
import type { UsageCard } from './api.js'
import type { ExtraUsage } from './extra-usage-schema.js'
import { CredentialModel, type CredentialValueResolver } from './credentials.js'
import { AiAccountsSchema } from './effect-schema.js'
import { readKeychainSecret } from './keychain.js'
import { ProviderUsageModel, type UsageWindow } from './usage.js'
import { providerFetch } from './provider-request.js'

export interface ClaudeAccountServiceDependencies {
  readonly readFile: typeof readFile
  readonly readKeyFromEnv: typeof CredentialModel.readKeyFromEnv
  readonly readKeychainSecret: typeof readKeychainSecret
  readonly fetch: typeof fetch
  readonly now: () => number
}

type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/**
 * Claude (Anthropic subscription) accounts.
 *
 * Claude Code owns the login: `claude` signs in under `CLAUDE_CONFIG_DIR`
 * (default `~/.claude`) and keeps the OAuth credential in the macOS keychain, or
 * in `<dir>/.credentials.json` elsewhere. This module only reads it — it never
 * refreshes or rewrites the credential, because a refresh rotates the token
 * Claude Code itself holds. A long-lived `claude setup-token` value in a named
 * variable serves inference without that dependency; quota still needs the
 * interactive login, whose token carries the profile scope.
 */

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

const DEFAULT_CONFIG_DIR = join(homedir(), '.claude')

const expandHome = (value: string): string => (value.startsWith('~/') ? join(homedir(), value.slice(2)) : value)

/** Claude Code keeps an emptied login record after `/logout`; the Claude desktop app's login is separate and unusable here. */
const signedOutMessage = (configDir: string): string =>
  `Claude Code is signed out on this machine (the Claude desktop app keeps its own login, which Claude Code cannot use). Run: ${ClaudeAccountModel.claudeLoginHint(configDir)}, or store a \`claude setup-token\` token as this account's setup token.`

const oauthSchema = Schema.Struct({
  claudeAiOauth: Schema.Struct({
    accessToken: Schema.String.check(Schema.isMinLength(1)),
    expiresAt: Schema.optional(Schema.Number.check(Schema.isFinite())),
    subscriptionType: Schema.optional(Schema.NullOr(Schema.String)),
  }),
})

interface ClaudeCredential {
  readonly accessToken: string
  readonly expiresAt: number | undefined
  readonly plan: string | undefined
}

const parseCredential = (raw: string): ClaudeCredential | undefined => {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return undefined
  }
  const parsed = AiAccountsSchema.decodeResult(oauthSchema, json)
  if (parsed._tag !== 'Success') return undefined
  return {
    accessToken: parsed.success.claudeAiOauth.accessToken,
    expiresAt: parsed.success.claudeAiOauth.expiresAt,
    plan: parsed.success.claudeAiOauth.subscriptionType ?? undefined,
  }
}

type StoredLogin = { readonly kind: 'signed-in'; readonly credential: ClaudeCredential } | { readonly kind: 'signed-out' } | { readonly kind: 'missing' }

const readClaudeLogin = async (configDir: string, dependencies: ClaudeAccountServiceDependencies): Promise<StoredLogin> => {
  const raw =
    (await dependencies.readFile(join(configDir, '.credentials.json'), 'utf8').catch(() => undefined)) ??
    (await dependencies.readKeychainSecret({ service: ClaudeAccountModel.claudeKeychainService(configDir) }))
  if (raw === undefined) return { kind: 'missing' }
  const credential = parseCredential(raw)
  return credential === undefined ? { kind: 'signed-out' } : { kind: 'signed-in', credential }
}

const profileSchema = Schema.Struct({
  oauthAccount: Schema.optional(
    Schema.Struct({ emailAddress: Schema.optional(Schema.String), organizationName: Schema.optional(Schema.NullOr(Schema.String)) }),
  ),
})

/** The default config dir keeps its profile beside it, `~/.claude.json`; a custom one keeps it inside. */
const readClaudeIdentity = async (configDir: string, dependencies: ClaudeAccountServiceDependencies): Promise<string | undefined> => {
  const path = configDir === DEFAULT_CONFIG_DIR ? join(homedir(), '.claude.json') : join(configDir, '.claude.json')
  try {
    const parsed = AiAccountsSchema.decodeResult(profileSchema, JSON.parse(await dependencies.readFile(path, 'utf8')))
    return parsed._tag === 'Success' ? parsed.success.oauthAccount?.emailAddress : undefined
  } catch {
    return undefined
  }
}

interface ClaudeAuthView {
  readonly signedIn: boolean
  readonly identity: string | undefined
  readonly plan: string | undefined
  readonly detail: string | undefined
}

const claudeWindowSchema = Schema.optional(
  Schema.NullOr(
    Schema.Struct({
      utilization: Schema.Number.check(Schema.isFinite()),
      resets_at: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
)

const nullableNumber = Schema.optional(Schema.NullOr(Schema.Number.check(Schema.isFinite())))

/** Pay-as-you-go spend past the plan; amounts are in the currency's minor unit (cents). */
const claudeExtraUsageSchema = Schema.Struct({
  is_enabled: Schema.optional(Schema.NullOr(Schema.Boolean)),
  monthly_limit: nullableNumber,
  used_credits: nullableNumber,
  utilization: nullableNumber,
  currency: Schema.optional(Schema.NullOr(Schema.String)),
  resets_at: Schema.optional(Schema.NullOr(Schema.String)),
})

type ClaudeExtraUsageBody = typeof claudeExtraUsageSchema.Type

const claudeUsageSchema = Schema.Struct({
  // A malformed extra_usage block must not cost the account its quota windows.
  extra_usage: Schema.optional(Schema.Unknown),
  five_hour: claudeWindowSchema,
  seven_day: claudeWindowSchema,
  seven_day_opus: claudeWindowSchema,
  seven_day_sonnet: claudeWindowSchema,
})

const CLAUDE_WINDOWS = [
  ['five_hour', 'Current session'],
  ['seven_day', 'Weekly limit'],
  ['seven_day_opus', 'Weekly Opus'],
  ['seven_day_sonnet', 'Weekly Sonnet'],
] as const

/**
 * Claude's `extra_usage`: whether pay-as-you-go spend is on, what it spent this month and the monthly cap, in cents.
 * Anthropic reports no reset for it; `resets_at` is read only if a later response adds one. A block that says
 * nothing (no flag, no amounts) yields nothing, as does a malformed one, so the card falls back to its windows.
 */
const toExtraUsage = (extra: ClaudeExtraUsageBody): ExtraUsage | undefined => {
  const enabled = extra.is_enabled === true
  const used = extra.used_credits === undefined || extra.used_credits === null ? null : Math.max(0, extra.used_credits) / 100
  const monthlyLimit = extra.monthly_limit === undefined || extra.monthly_limit === null ? null : Math.max(0, extra.monthly_limit) / 100
  if (typeof extra.is_enabled !== 'boolean' && used === null && monthlyLimit === null) return undefined
  const reported = extra.utilization === undefined || extra.utilization === null ? null : extra.utilization
  const derived = used !== null && monthlyLimit !== null && monthlyLimit > 0 ? (used / monthlyLimit) * 100 : null
  const currency = extra.currency?.trim().toUpperCase() ?? ''
  const resetsAt = extra.resets_at === undefined || extra.resets_at === null ? Number.NaN : Date.parse(extra.resets_at)
  return {
    enabled,
    used,
    monthlyLimit,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
    percentUsed: reported ?? derived,
    resetsAt: Number.isNaN(resetsAt) ? null : resetsAt,
  }
}

export class ClaudeAccountModel {
  static resolveClaudeConfigDir = (homePath: string): string => {
    const trimmed = homePath.trim()
    return trimmed === '' ? DEFAULT_CONFIG_DIR : resolve(expandHome(trimmed))
  }

  /**
   * A route on the account's Claude Code login (no key variable) runs through the CLI: the login's seat allowance only
   * covers requests Claude Code makes, and HTTP requests with it are billed to the organization's extra usage. A
   * setup-token or API key keeps the Messages API.
   */
  static usesCliTransport = (route: { readonly apiKeyEnv: string }): boolean => route.apiKeyEnv.trim() === ''

  /** Claude Code suffixes its keychain item with a hash of a non-default config dir. */
  static claudeKeychainService = (configDir: string): string =>
    configDir === DEFAULT_CONFIG_DIR ? 'Claude Code-credentials' : `Claude Code-credentials-${createHash('sha256').update(configDir).digest('hex').slice(0, 8)}`

  /**
   * The environment a `claude` process for this account runs with. Claude Code hashes its keychain item and moves its
   * profile whenever CLAUDE_CONFIG_DIR is set, even to `~/.claude`, so the default login is only reachable with the
   * variable unset; setting it made requests read a different, empty login than the one the status check reads.
   */
  static cliEnvironment = (input: { readonly environment: NodeJS.ProcessEnv; readonly configDir: string }): NodeJS.ProcessEnv => {
    const environment = { ...input.environment }
    delete environment['CLAUDE_CONFIG_DIR']
    delete environment['CLAUDE_SECURESTORAGE_CONFIG_DIR']
    if (input.configDir !== DEFAULT_CONFIG_DIR) environment['CLAUDE_CONFIG_DIR'] = input.configDir
    return environment
  }

  static shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

  static claudeLoginHint = (configDir: string): string =>
    configDir === DEFAULT_CONFIG_DIR ? 'claude auth login' : `CLAUDE_CONFIG_DIR=${ClaudeAccountModel.shellQuote(configDir)} claude auth login`

  /** `utilization` is percent used; a window the plan does not meter arrives as null. */
  static parseClaudeUsage = (raw: JsonValue, plan: string | undefined): UsageCard => {
    const parsed = AiAccountsSchema.decodeResult(claudeUsageSchema, raw)
    if (parsed._tag !== 'Success') return ProviderUsageModel.emptyUsage('error', 'Claude returned an unsupported usage response.')
    const windows: UsageWindow[] = []
    for (const [key, label] of CLAUDE_WINDOWS) {
      const window = parsed.success[key]
      if (window === undefined || window === null) continue
      const resetsAt = window.resets_at === undefined || window.resets_at === null ? Number.NaN : Date.parse(window.resets_at)
      windows.push({ label, percentRemaining: ProviderUsageModel.remainingFromUsed(window.utilization), resetsAt: Number.isNaN(resetsAt) ? null : resetsAt })
    }
    const card: UsageCard = { status: 'ok', message: null, identity: null, plan: plan ?? null, windows, bankedResets: 0, bankedResetExpiries: [] }
    const block = parsed.success.extra_usage
    if (block === undefined || block === null) return card
    const extra = AiAccountsSchema.decodeResult(claudeExtraUsageSchema, block)
    const extraUsage = extra._tag === 'Success' ? toExtraUsage(extra.success) : undefined
    return extraUsage === undefined ? card : { ...card, extraUsage }
  }
}

/** A usage reading serves every caller for this long. */
const CLAUDE_USAGE_FRESH_MS = 2 * 60_000
/** Back-off after a 429 that names no Retry-After. */
const CLAUDE_USAGE_BACKOFF_MS = 10 * 60_000

type UsageRead = { readonly card: UsageCard; readonly retryAfterMs?: number }

type UsageReading = { readonly card: UsageCard; readonly at: number }

type UsageCacheEntry =
  | { readonly kind: 'fetching'; readonly request: Promise<UsageCard>; readonly reading: UsageReading | undefined; readonly controller: AbortController }
  | { readonly kind: 'cached'; readonly reading: UsageReading }
  | { readonly kind: 'backoff'; readonly reading: UsageReading | undefined; readonly until: number }

const retryAfterMs = (header: string | null): number => {
  const seconds = Number(header)
  return header !== null && Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : CLAUDE_USAGE_BACKOFF_MS
}

const isFresh = (reading: UsageReading, now: number): boolean => now - reading.at < CLAUDE_USAGE_FRESH_MS

const cancelledUsage = (): UsageCard => ProviderUsageModel.emptyUsage('error', 'Usage collection was cancelled.')

/** A shared reading says how old it is and when a new one can reach Claude, so a refresh it answers does not look live. */
const heldReading = (reading: UsageReading): UsageCard => ({ ...reading.card, readAt: reading.at, nextReadAt: reading.at + CLAUDE_USAGE_FRESH_MS })

/** The last good reading, labelled with its age, while Anthropic asks us to wait; a rate-limited card without one. */
const staleOrLimited = (reading: UsageReading | undefined, until: number, now: number): UsageCard => {
  if (reading === undefined) return { ...ProviderUsageModel.emptyUsage('rate-limited', 'Claude rate-limited the usage request.'), nextReadAt: until }
  const minutes = Math.max(1, Math.round((now - reading.at) / 60_000))
  const message = `Reading from ${String(minutes)} min ago; Claude asked to wait before the next one.`
  return {
    ...reading.card,
    message,
    readAt: reading.at,
    nextReadAt: until,
    readFailure: { status: 'rate-limited', message: 'Claude asked to wait before the next usage reading.' },
  }
}

const settledEntry = (read: UsageRead, reading: UsageReading | undefined, now: number): UsageCacheEntry | undefined => {
  if (read.retryAfterMs !== undefined) return { kind: 'backoff', reading, until: now + read.retryAfterMs }
  if (read.card.status === 'ok') return { kind: 'cached', reading: { card: read.card, at: now } }
  return reading === undefined ? undefined : { kind: 'cached', reading }
}

const settledCard = (read: UsageRead, entry: UsageCacheEntry | undefined, now: number): UsageCard => {
  if (entry?.kind === 'backoff') return staleOrLimited(entry.reading, entry.until, now)
  return entry?.kind === 'cached' && read.card.status === 'ok' ? heldReading(entry.reading) : read.card
}

/** A shared read outlives any one caller: cancelling your request stops only your wait on it. */
const abortableUsage = (request: Promise<UsageCard>, signal: AbortSignal | undefined): Promise<UsageCard> => {
  if (signal === undefined) return request
  if (signal.aborted) return Promise.resolve(cancelledUsage())
  return new Promise<UsageCard>((resolve, reject) => {
    const onAbort = (): void => resolve(cancelledUsage())
    signal.addEventListener('abort', onAbort, { once: true })
    const settle = async (): Promise<void> => {
      try {
        const card = await request
        signal.removeEventListener('abort', onAbort)
        resolve(card)
      } catch (error) {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    }
    void settle()
  })
}

const fetchUsage = async (
  configDir: string,
  dependencies: ClaudeAccountServiceDependencies,
  signal: AbortSignal | undefined,
  onAuthenticated?: () => void,
): Promise<UsageRead> => {
  if (signal?.aborted) return { card: ProviderUsageModel.emptyUsage('error', 'Usage collection was cancelled.') }
  const login = await readClaudeLogin(configDir, dependencies)
  if (login.kind === 'signed-out') return { card: ProviderUsageModel.emptyUsage('unauthenticated', signedOutMessage(configDir)) }
  if (login.kind === 'missing')
    return { card: ProviderUsageModel.emptyUsage('unauthenticated', 'Quota needs the Claude Code login; a setup-token cannot read it.') }
  const credential = login.credential
  if (credential.expiresAt !== undefined && credential.expiresAt <= dependencies.now()) {
    return { card: ProviderUsageModel.emptyUsage('unauthenticated', 'The Claude Code login has expired. Run Claude Code once to refresh it.') }
  }
  try {
    const response = await providerFetch({
      provider: 'claude',
      operation: 'usage',
      url: CLAUDE_USAGE_URL,
      init: {
        headers: { authorization: `Bearer ${credential.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' },
        redirect: 'error',
        signal: ProviderUsageModel.usageSignal(signal),
      },
      fetch: dependencies.fetch,
    })
    if (response.status === 401 || response.status === 403)
      return { card: ProviderUsageModel.emptyUsage('unauthenticated', 'Claude rejected this login; sign in again.') }
    if (response.status === 429)
      return {
        card: ProviderUsageModel.emptyUsage('rate-limited', 'Claude rate-limited the usage request.'),
        retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
      }
    if (!response.ok) return { card: ProviderUsageModel.emptyUsage('error', `Claude returned ${String(response.status)} for usage.`) }
    const raw: JsonValue = await response.json()
    const parsed = AiAccountsSchema.decodeResult(claudeUsageSchema, raw)
    if (parsed._tag === 'Success' && !signal?.aborted) {
      const usage = parsed.success
      if (CLAUDE_WINDOWS.some(([key]) => usage[key] !== undefined) || usage.extra_usage !== undefined) onAuthenticated?.()
    }
    return { card: ClaudeAccountModel.parseClaudeUsage(raw, credential.plan) }
  } catch (cause) {
    return { card: ProviderUsageModel.emptyUsage('error', cause instanceof Error ? cause.message : 'Claude usage could not be read.') }
  }
}

export const createClaudeAccountService = (dependencies: ClaudeAccountServiceDependencies) => {
  const usageReads = new Map<string, UsageCacheEntry>()
  return {
    invalidateUsage: (configDir: string): void => {
      const entry = usageReads.get(configDir)
      if (entry?.kind === 'fetching') entry.controller.abort()
      usageReads.delete(configDir)
    },
    describeAuth: async (input: {
      readonly configDir: string
      readonly keyEnv: string
      readonly now: number
      readonly resolveCredential?: CredentialValueResolver | undefined
    }): Promise<ClaudeAuthView> => {
      const [login, identity, named] = await Promise.all([
        readClaudeLogin(input.configDir, dependencies),
        readClaudeIdentity(input.configDir, dependencies),
        input.resolveCredential === undefined ? Promise.resolve(dependencies.readKeyFromEnv(input.keyEnv)) : input.resolveCredential(input.keyEnv),
      ])
      const hasKey = named.length > 0
      const credential = login.kind === 'signed-in' ? login.credential : undefined
      const expired = credential?.expiresAt !== undefined && credential.expiresAt <= input.now
      const signedOutDetail = login.kind === 'signed-out' ? signedOutMessage(input.configDir) : undefined
      const loginDetail = expired ? 'The Claude Code login has expired. Run Claude Code once on this account to refresh it.' : signedOutDetail
      const detail = hasKey ? undefined : loginDetail
      return { signedIn: hasKey || (credential !== undefined && !expired), identity, plan: credential?.plan, detail }
    },

    resolveInferenceToken: async (input: {
      readonly configDir: string
      readonly keyEnv: string
      readonly now: number
      readonly resolveCredential?: CredentialValueResolver | undefined
    }): Promise<string> => {
      const named = input.resolveCredential === undefined ? dependencies.readKeyFromEnv(input.keyEnv) : await input.resolveCredential(input.keyEnv)
      if (named.length > 0) return named
      const login = await readClaudeLogin(input.configDir, dependencies)
      if (login.kind === 'signed-out') throw new Error(signedOutMessage(input.configDir))
      if (login.kind === 'missing') throw new Error(`No Claude login found. Run: ${ClaudeAccountModel.claudeLoginHint(input.configDir)}`)
      const credential = login.credential
      if (credential.expiresAt !== undefined && credential.expiresAt <= input.now) {
        throw new Error('The Claude Code login has expired. Run Claude Code once on this account to refresh it.')
      }
      return credential.accessToken
    },

    readUsage: async (configDir: string, signal?: AbortSignal, onAuthenticated?: () => void): Promise<UsageCard> => {
      // Admission evidence is attempt-local: bypass cached and shared requests without disturbing the UI cache.
      if (onAuthenticated !== undefined) return (await fetchUsage(configDir, dependencies, signal, onAuthenticated)).card
      // The page, the footer, the history recorder and quota continuations all read here; Anthropic rate-limits this
      // endpoint after a few calls a minute, so one reading serves them all for a while and a 429 backs off.
      const now = dependencies.now()
      const known = usageReads.get(configDir)
      if (known?.kind === 'cached' && isFresh(known.reading, now)) return heldReading(known.reading)
      if (known?.kind === 'backoff' && now < known.until) return staleOrLimited(known.reading, known.until, now)
      if (known?.kind === 'fetching') return abortableUsage(known.request, signal)
      if (signal?.aborted === true) return cancelledUsage()
      const reading = known?.reading
      const controller = new AbortController()
      const request = fetchUsage(configDir, dependencies, controller.signal).then(read => {
        const current = usageReads.get(configDir)
        if (current?.kind !== 'fetching' || current.controller !== controller) return read.card
        const entry = settledEntry(read, reading, dependencies.now())
        if (entry === undefined) usageReads.delete(configDir)
        else usageReads.set(configDir, entry)
        return settledCard(read, entry, dependencies.now())
      })
      usageReads.set(configDir, { kind: 'fetching', request, reading, controller })
      return abortableUsage(request, signal)
    },
  }
}

export const claudeAccountService = createClaudeAccountService({
  readFile,
  readKeyFromEnv: CredentialModel.readKeyFromEnv,
  readKeychainSecret,
  fetch,
  now: Date.now,
})
