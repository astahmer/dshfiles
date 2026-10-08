import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { UsageCard } from './api.js'
import { readKeyFromEnv } from './credentials.js'
import { readKeychainSecret } from './keychain.js'
import { emptyUsage, remainingFromUsed, usageSignal, type UsageWindow } from './usage.js'

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

export const resolveClaudeConfigDir = (homePath: string): string => {
  const trimmed = homePath.trim()
  return trimmed === '' ? DEFAULT_CONFIG_DIR : resolve(expandHome(trimmed))
}

/** Claude Code suffixes its keychain item with a hash of a non-default config dir. */
export const claudeKeychainService = (configDir: string): string =>
  configDir === DEFAULT_CONFIG_DIR ? 'Claude Code-credentials' : `Claude Code-credentials-${createHash('sha256').update(configDir).digest('hex').slice(0, 8)}`

export const claudeLoginHint = (configDir: string): string =>
  configDir === DEFAULT_CONFIG_DIR ? 'claude /login' : `CLAUDE_CONFIG_DIR="${configDir}" claude /login`

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

const readClaudeCredential = async (configDir: string): Promise<ClaudeCredential | undefined> => {
  const fromFile = await readFile(join(configDir, '.credentials.json'), 'utf8').then(parseCredential, () => undefined)
  if (fromFile !== undefined) return fromFile
  const fromKeychain = await readKeychainSecret({ service: claudeKeychainService(configDir) })
  return fromKeychain === undefined ? undefined : parseCredential(fromKeychain)
}

const profileSchema = z.object({
  oauthAccount: z.object({ emailAddress: z.string().optional(), organizationName: z.string().nullish() }).optional(),
})

/** The default config dir keeps its profile beside it, `~/.claude.json`; a custom one keeps it inside. */
const readClaudeIdentity = async (configDir: string): Promise<string | undefined> => {
  const path = configDir === DEFAULT_CONFIG_DIR ? join(homedir(), '.claude.json') : join(configDir, '.claude.json')
  try {
    const parsed = profileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
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

export const describeClaudeAuth = async (input: { readonly configDir: string; readonly keyEnv: string; readonly now: number }): Promise<ClaudeAuthView> => {
  const [credential, identity] = await Promise.all([readClaudeCredential(input.configDir), readClaudeIdentity(input.configDir)])
  const hasKey = readKeyFromEnv(input.keyEnv).length > 0
  const expired = credential?.expiresAt !== undefined && credential.expiresAt <= input.now
  return {
    signedIn: hasKey || (credential !== undefined && !expired),
    identity,
    plan: credential?.plan,
    detail: expired && !hasKey ? 'The Claude Code login has expired. Run Claude Code once on this account to refresh it.' : undefined,
  }
}

/** The token a request authenticates with: the named setup-token first, then the live login. */
export const resolveClaudeInferenceToken = async (input: { readonly configDir: string; readonly keyEnv: string; readonly now: number }): Promise<string> => {
  const named = readKeyFromEnv(input.keyEnv)
  if (named.length > 0) return named
  const credential = await readClaudeCredential(input.configDir)
  if (credential === undefined) throw new Error(`No Claude login found. Run: ${claudeLoginHint(input.configDir)}`)
  if (credential.expiresAt !== undefined && credential.expiresAt <= input.now) {
    throw new Error('The Claude Code login has expired. Run Claude Code once on this account to refresh it.')
  }
  return credential.accessToken
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

/** `utilization` is percent used; a window the plan does not meter arrives as null. */
export const parseClaudeUsage = (raw: unknown, plan: string | undefined): UsageCard => {
  const parsed = claudeUsageSchema.safeParse(raw)
  if (!parsed.success) return emptyUsage('error', 'Claude returned an unsupported usage response.')
  const windows: UsageWindow[] = []
  for (const [key, label] of CLAUDE_WINDOWS) {
    const window = parsed.data[key]
    if (window === undefined || window === null) continue
    const resetsAt = window.resets_at === undefined || window.resets_at === null ? Number.NaN : Date.parse(window.resets_at)
    windows.push({ label, percentRemaining: remainingFromUsed(window.utilization), resetsAt: Number.isNaN(resetsAt) ? null : resetsAt })
  }
  return { status: 'ok', message: null, identity: null, plan: plan ?? null, windows, bankedResets: 0, bankedResetExpiries: [] }
}

export const readClaudeUsage = async (configDir: string, signal?: AbortSignal): Promise<UsageCard> => {
  if (signal?.aborted) return emptyUsage('error', 'Usage collection was cancelled.')
  const credential = await readClaudeCredential(configDir)
  if (credential === undefined) return emptyUsage('unauthenticated', 'Quota needs the Claude Code login; a setup-token cannot read it.')
  if (credential.expiresAt !== undefined && credential.expiresAt <= Date.now()) {
    return emptyUsage('unauthenticated', 'The Claude Code login has expired. Run Claude Code once to refresh it.')
  }
  try {
    const response = await fetch(CLAUDE_USAGE_URL, {
      headers: { authorization: `Bearer ${credential.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' },
      redirect: 'error',
      signal: usageSignal(signal),
    })
    if (response.status === 401 || response.status === 403) return emptyUsage('unauthenticated', 'Claude rejected this login; sign in again.')
    if (response.status === 429) return emptyUsage('rate-limited', 'Claude rate-limited the usage request.')
    if (!response.ok) return emptyUsage('error', `Claude returned ${String(response.status)} for usage.`)
    return parseClaudeUsage(await response.json(), credential.plan)
  } catch (cause) {
    return emptyUsage('error', cause instanceof Error ? cause.message : 'Claude usage could not be read.')
  }
}
