import type { AiAccountsConfig, CodexAccountConfig } from './account-config.js'
import { COMMANDCODE_KIND as CC_KIND, DEFAULT_COMMANDCODE_KEY_ENV } from './commandcode-provider.js'
import { resolveClaudeConfigDir } from './claude-account.js'
import { CodexHomeError, resolveCodexHomeLayout, type CodexHomeLayout } from './codex-home.js'

export const CODEX_KIND = 'codex'
export const OPENCODE_KIND = 'opencode-go'
export const COMMANDCODE_KIND = CC_KIND
export const CLAUDE_KIND = 'claude'

const SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/

/** An empty instance id means "the driver's own default route". */
export const normalizeInstanceId = (value: string, fallback: string): string => {
  const trimmed = value.trim()
  if (trimmed.length === 0) return fallback
  if (!SLUG_PATTERN.test(trimmed)) {
    throw new TypeError(`Instance id ${JSON.stringify(trimmed)} must start with a letter and use only letters, digits, '-' or '_' (max 64 characters).`)
  }
  return trimmed
}

const displayNameFor = (explicit: string, kind: string, instanceId: string): string => {
  const trimmed = explicit.trim()
  if (trimmed.length > 0) return trimmed
  return instanceId === kind ? kind : `${kind} (${instanceId})`
}

export interface CodexRoute {
  readonly kind: typeof CODEX_KIND
  readonly instanceId: string
  readonly displayName: string
  readonly enabled: boolean
  readonly layout: CodexHomeLayout
}

export interface KeyedRoute {
  readonly kind: typeof OPENCODE_KIND | typeof COMMANDCODE_KIND
  readonly instanceId: string
  readonly displayName: string
  readonly apiKeyEnv: string
  readonly apiBaseUrl: string
  readonly enabled: boolean
}

export interface ClaudeRoute {
  readonly kind: typeof CLAUDE_KIND
  readonly instanceId: string
  readonly displayName: string
  readonly configDir: string
  readonly apiKeyEnv: string
  readonly enabled: boolean
}

export type Route = CodexRoute | KeyedRoute | ClaudeRoute

export const keyEnvFor = (route: KeyedRoute): string =>
  route.apiKeyEnv.trim().length > 0 ? route.apiKeyEnv.trim() : route.kind === COMMANDCODE_KIND ? DEFAULT_COMMANDCODE_KEY_ENV : 'OPENCODE_API_KEY'

const shadowHomeFor = (account: CodexAccountConfig, instanceId: string, root: string): string => {
  const explicit = account.shadowHomePath.trim()
  if (explicit.length > 0) return explicit
  // One shadow per account under a single root keeps the T3 trick without
  // making every account restate the path.
  return `${root.replace(/\/$/, '')}/${instanceId}`
}

export interface BuiltRoutes {
  readonly routes: Map<string, Route>
  /** Accounts left out, with the reason: an invalid Codex home, or a provider id another plugin already serves. */
  readonly rejected: readonly string[]
}

/**
 * `takenProviders` are provider ids another plugin already registered. DSH rejects a duplicate adapter for the whole
 * registration and fails the boot, so an enabled account on such an id is left out instead.
 */
export const buildRoutes = (config: AiAccountsConfig, options: { readonly takenProviders?: ReadonlySet<string> } = {}): BuiltRoutes => {
  const routes = new Map<string, Route>()
  const rejected: string[] = []
  for (const account of config.codexAccounts) {
    const instanceId = normalizeInstanceId(account.instanceId, CODEX_KIND)
    let layout: CodexHomeLayout
    try {
      layout = resolveCodexHomeLayout({
        homePath: account.homePath,
        shadowHomePath: shadowHomeFor(account, instanceId, config.codexShadowRoot),
      })
    } catch (error) {
      if (!(error instanceof CodexHomeError)) throw error
      rejected.push(`${instanceId}: ${error.message}`)
      continue
    }
    routes.set(instanceId, {
      kind: CODEX_KIND,
      instanceId,
      displayName: displayNameFor(account.displayName, CODEX_KIND, instanceId),
      enabled: account.enabled,
      layout,
    })
  }
  for (const account of config.opencodeAccounts) {
    const kind = account.kind === COMMANDCODE_KIND ? COMMANDCODE_KIND : OPENCODE_KIND
    const instanceId = normalizeInstanceId(account.instanceId, kind)
    routes.set(instanceId, {
      kind,
      instanceId,
      displayName: displayNameFor(account.displayName, kind, instanceId),
      apiKeyEnv: account.apiKeyEnv,
      apiBaseUrl: account.apiBaseUrl,
      enabled: account.enabled,
    })
  }
  for (const account of config.claudeAccounts) {
    const instanceId = normalizeInstanceId(account.instanceId, CLAUDE_KIND)
    routes.set(instanceId, {
      kind: CLAUDE_KIND,
      instanceId,
      displayName: displayNameFor(account.displayName, CLAUDE_KIND, instanceId),
      configDir: resolveClaudeConfigDir(account.configDir),
      apiKeyEnv: account.apiKeyEnv,
      enabled: account.enabled,
    })
  }
  for (const [instanceId, route] of routes) {
    if (!route.enabled || options.takenProviders?.has(instanceId) !== true) continue
    routes.delete(instanceId)
    rejected.push(`${instanceId}: another plugin already serves provider "${instanceId}"`)
  }
  return { routes, rejected }
}
