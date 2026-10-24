import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { UsageCard } from './api.js'
import { CredentialModel, type CredentialValueResolver } from './credentials.js'
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

const oauthSchema = z.object({
  claudeAiOauth: z.object({
    accessToken: z.string().min(1),
    expiresAt: z.number().optional(),
    subscriptionType: z.string().nullish(),
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
  const parsed = oauthSchema.safeParse(json)
  if (!parsed.success) return undefined
  return {
    accessToken: parsed.data.claudeAiOauth.accessToken,
    expiresAt: parsed.data.claudeAiOauth.expiresAt,
    plan: parsed.data.claudeAiOauth.subscriptionType ?? undefined,
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

const profileSchema = z.object({
  oauthAccount: z.object({ emailAddress: z.string().optional(), organizationName: z.string().nullish() }).optional(),
})

/** The default config dir keeps its profile beside it, `~/.claude.json`; a custom one keeps it inside. */
const readClaudeIdentity = async (configDir: string, dependencies: ClaudeAccountServiceDependencies): Promise<string | undefined> => {
  const path = configDir === DEFAULT_CONFIG_DIR ? join(homedir(), '.claude.json') : join(configDir, '.claude.json')
  try {
    const parsed = profileSchema.safeParse(JSON.parse(await dependencies.readFile(path, 'utf8')))
    return parsed.success ? parsed.data.oauthAccount?.emailAddress : undefined
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

const claudeWindowSchema = z
  .object({
    utilization: z.number().finite(),
    resets_at: z.string().nullish(),
  })
  .nullish()

const claudeUsageSchema = z.object({
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

  static claudeLoginHint = (configDir: string): string =>
    configDir === DEFAULT_CONFIG_DIR ? 'claude auth login' : `CLAUDE_CONFIG_DIR="${configDir}" claude auth login`

  /** `utilization` is percent used; a window the plan does not meter arrives as null. */
  static parseClaudeUsage = (raw: JsonValue, plan: string | undefined): UsageCard => {
    const parsed = claudeUsageSchema.safeParse(raw)
    if (!parsed.success) return ProviderUsageModel.emptyUsage('error', 'Claude returned an unsupported usage response.')
    const windows: UsageWindow[] = []
    for (const [key, label] of CLAUDE_WINDOWS) {
      const window = parsed.data[key]
      if (window === undefined || window === null) continue
      const resetsAt = window.resets_at === undefined || window.resets_at === null ? Number.NaN : Date.parse(window.resets_at)
      windows.push({ label, percentRemaining: ProviderUsageModel.remainingFromUsed(window.utilization), resetsAt: Number.isNaN(resetsAt) ? null : resetsAt })
    }
    return { status: 'ok', message: null, identity: null, plan: plan ?? null, windows, bankedResets: 0, bankedResetExpiries: [] }
  }
}

/** A usage reading serves every caller for this long. */
const CLAUDE_USAGE_FRESH_MS = 2 * 60_000
/** Back-off after a 429 that names no Retry-After. */
const CLAUDE_USAGE_BACKOFF_MS = 10 * 60_000

type UsageRead = { readonly card: UsageCard; readonly retryAfterMs?: number }

interface UsageEntry {
  card?: UsageCard
  at: number
  backoffUntil: number
  inFlight?: Promise<UsageCard> | undefined
}

const retryAfterMs = (header: string | null): number => {
  const seconds = Number(header)
  return header !== null && Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : CLAUDE_USAGE_BACKOFF_MS
}

/** The last good reading, labelled with its age, while Anthropic asks us to wait; a rate-limited card without one. */
const staleOrLimited = (entry: UsageEntry, now: number): UsageCard => {
  if (entry.card === undefined) return ProviderUsageModel.emptyUsage('rate-limited', 'Claude rate-limited the usage request.')
  const minutes = Math.max(1, Math.round((now - entry.at) / 60_000))
  return { ...entry.card, message: `Reading from ${String(minutes)} min ago; Claude asked to wait before the next one.` }
}

const fetchUsage = async (configDir: string, dependencies: ClaudeAccountServiceDependencies, signal: AbortSignal | undefined): Promise<UsageRead> => {
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
    return { card: ClaudeAccountModel.parseClaudeUsage(await response.json(), credential.plan) }
  } catch (cause) {
    return { card: ProviderUsageModel.emptyUsage('error', cause instanceof Error ? cause.message : 'Claude usage could not be read.') }
  }
}

export const createClaudeAccountService = (dependencies: ClaudeAccountServiceDependencies) => {
  const usageReads = new Map<string, UsageEntry>()
  return {
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

    readUsage: async (configDir: string, signal?: AbortSignal): Promise<UsageCard> => {
      // The page, the footer, the history recorder and quota continuations all read here; Anthropic rate-limits this
      // endpoint after a few calls a minute, so one reading serves them all for a while and a 429 backs off.
      const now = dependencies.now()
      const known = usageReads.get(configDir)
      if (known?.card !== undefined && now - known.at < CLAUDE_USAGE_FRESH_MS) return known.card
      if (known !== undefined && now < known.backoffUntil) return staleOrLimited(known, now)
      if (known?.inFlight !== undefined) return known.inFlight
      const inFlight = fetchUsage(configDir, dependencies, signal).then(read => {
        const entry = usageReads.get(configDir) ?? { at: 0, backoffUntil: 0 }
        entry.inFlight = undefined
        usageReads.set(configDir, entry)
        if (read.retryAfterMs !== undefined) {
          entry.backoffUntil = dependencies.now() + read.retryAfterMs
          return staleOrLimited(entry, dependencies.now())
        }
        if (read.card.status === 'ok') {
          entry.card = read.card
          entry.at = dependencies.now()
        }
        return read.card
      })
      usageReads.set(configDir, { ...(known ?? { at: 0, backoffUntil: 0 }), inFlight })
      return inFlight
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
