import type { AccountStoreFile } from './account-store.js'
import type { Distribution } from './account-pool.js'
import { CodexHomeModel } from './codex-home.js'
import { CredentialModel } from './credentials.js'
export interface CodexAccountConfig {
  readonly instanceId: string
  readonly displayName: string
  readonly homePath: string
  readonly shadowHomePath: string
  readonly additionalModelIds: readonly string[]
  readonly enabled: boolean
}

export interface KeyedAccountConfig {
  readonly instanceId: string
  readonly displayName: string
  readonly kind: 'opencode-go' | 'commandcode' | 'mistral'
  /** Environment variable holding this account's key. */
  readonly apiKeyEnv: string
  readonly authSource?: 'cli' | 'reference' | undefined
  /** Alternate API base, for a self-hosted or staging Command Code; unused by Mistral. */
  readonly apiBaseUrl: string
  readonly enabled: boolean
}

export type OpenCodeAccountConfig = KeyedAccountConfig

export interface GitHubCopilotAccountConfig {
  readonly instanceId: string
  readonly displayName: string
  readonly enabled: boolean
}

export interface ClaudeAccountConfig {
  readonly instanceId: string
  readonly displayName: string
  /** CLAUDE_CONFIG_DIR holding the Claude Code login; empty means ~/.claude. */
  readonly configDir: string
  /** Optional variable holding a `claude setup-token` value, preferred for inference. */
  readonly apiKeyEnv: string
  readonly enabled: boolean
}

export interface AntigravityAccountConfig {
  readonly instanceId: string
  readonly displayName: string
  /** HOME the Antigravity CLI runs with, whose `.gemini` holds the login; empty means the Host user's home. */
  readonly home: string
  readonly enabled: boolean
}

/** A Mistral Vibe CLI account: the route runs `vibe` with this VIBE_HOME's signed-in session instead of sending HTTP. */
export interface VibeAccountConfig {
  readonly instanceId: string
  readonly displayName: string
  /** The account's VIBE_HOME; empty means the Host user's `~/.vibe`. */
  readonly home: string
  readonly enabled: boolean
}

export interface AiAccountsConfig {
  readonly codexAccounts: readonly CodexAccountConfig[]
  readonly opencodeAccounts: readonly OpenCodeAccountConfig[]
  readonly claudeAccounts: readonly ClaudeAccountConfig[]
  readonly githubCopilotAccounts: readonly GitHubCopilotAccountConfig[]
  readonly antigravityAccounts: readonly AntigravityAccountConfig[]
  readonly vibeAccounts: readonly VibeAccountConfig[]
  readonly opencodeApiKey: string
  readonly distribution: Distribution
  readonly cooldownMs: number
  readonly codexShadowRoot: string
}

export const configFromAccountsFile = (file: AccountStoreFile): AiAccountsConfig => {
  const codexAccounts = file.accounts
    .filter(account => account.kind === 'codex')
    .map(account => ({
      instanceId: account.instanceId,
      displayName: account.displayName,
      homePath: account.homePath,
      shadowHomePath: account.shadowHomePath,
      additionalModelIds: account.additionalModelIds,
      enabled: account.enabled,
    }))
  const opencodeAccounts: KeyedAccountConfig[] = []
  const claudeAccounts: ClaudeAccountConfig[] = []
  const githubCopilotAccounts: GitHubCopilotAccountConfig[] = []
  const antigravityAccounts: AntigravityAccountConfig[] = []
  const vibeAccounts: VibeAccountConfig[] = []
  for (const account of file.accounts) {
    if (account.kind === 'codex' || account.kind === 'cursor') continue
    if (account.kind === 'github-copilot') {
      githubCopilotAccounts.push({ instanceId: account.instanceId, displayName: account.displayName, enabled: account.enabled })
      continue
    }
    if (account.kind === 'antigravity') {
      antigravityAccounts.push({ instanceId: account.instanceId, displayName: account.displayName, home: account.homePath, enabled: account.enabled })
      continue
    }
    if (account.kind === 'vibe') {
      vibeAccounts.push({ instanceId: account.instanceId, displayName: account.displayName, home: account.homePath, enabled: account.enabled })
      continue
    }
    if (account.kind === 'claude') {
      claudeAccounts.push({
        instanceId: account.instanceId,
        displayName: account.displayName,
        configDir: account.homePath,
        apiKeyEnv: account.apiKeyEnv,
        enabled: account.enabled,
      })
      continue
    }
    opencodeAccounts.push({
      instanceId: account.instanceId,
      displayName: account.displayName,
      kind: account.kind,
      authSource: account.authSource,
      apiKeyEnv: account.apiKeyEnv,
      apiBaseUrl: account.apiBaseUrl,
      enabled: account.enabled,
    })
  }
  if (file.accounts.length === 0)
    codexAccounts.push({ instanceId: 'codex', displayName: '', homePath: '', shadowHomePath: '', additionalModelIds: [], enabled: true })
  return {
    codexAccounts,
    opencodeAccounts,
    claudeAccounts,
    githubCopilotAccounts,
    antigravityAccounts,
    vibeAccounts,
    opencodeApiKey: CredentialModel.readKeyFromEnv('OPENCODE_API_KEY') ?? '',
    distribution: file.distribution,
    cooldownMs: file.cooldownMs,
    codexShadowRoot: file.shadowRoot || `${CodexHomeModel.accountHome()}/.codex-dshx`,
  }
}
