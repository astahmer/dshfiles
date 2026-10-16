import z from '@deepseek-ai/schemastery'
import type { readAccountFileSync } from './account-store.js'
import { DEFAULT_DISTRIBUTION, type Distribution } from './account-pool.js'
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
  readonly kind: 'opencode-go' | 'commandcode'
  /** Environment variable holding this account's key. */
  readonly apiKeyEnv: string
  /** Alternate API base, for a self-hosted or staging Command Code. */
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

export interface AiAccountsConfig {
  readonly codexAccounts: readonly CodexAccountConfig[]
  readonly opencodeAccounts: readonly OpenCodeAccountConfig[]
  readonly claudeAccounts: readonly ClaudeAccountConfig[]
  readonly githubCopilotAccounts: readonly GitHubCopilotAccountConfig[]
  readonly opencodeApiKey: string
  readonly distribution: Distribution
  readonly cooldownMs: number
  readonly codexShadowRoot: string
}

const CodexAccount = z.object({
  instanceId: z.string().default('codex'),
  displayName: z.string().default(''),
  homePath: z.string().default(''),
  shadowHomePath: z.string().default(''),
  additionalModelIds: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
})
const KeyedAccount = z.object({
  instanceId: z.string().default('opencode-go'),
  displayName: z.string().default(''),
  kind: z.union(['opencode-go', 'commandcode']).default('opencode-go'),
  apiKeyEnv: z.string().default(''),
  apiBaseUrl: z.string().default(''),
  enabled: z.boolean().default(true),
})
export const Config = z.object({
  codexAccounts: z
    .array(CodexAccount)
    .default([CodexAccount({})])
    .volatile(),
  opencodeAccounts: z.array(KeyedAccount).default([]).volatile(),
  opencodeApiKey: z.string().default('').volatile(),
  distribution: z.string().default(DEFAULT_DISTRIBUTION).volatile(),
  cooldownMs: z.number().default(300_000).volatile(),
  codexShadowRoot: z.string().default('').volatile(),
})

export const configFromAccountsFile = (file: ReturnType<typeof readAccountFileSync>): AiAccountsConfig => {
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
  for (const account of file.accounts) {
    if (account.kind === 'codex' || account.kind === 'cursor') continue
    if (account.kind === 'github-copilot') {
      githubCopilotAccounts.push({ instanceId: account.instanceId, displayName: account.displayName, enabled: account.enabled })
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
    opencodeApiKey: CredentialModel.readKeyFromEnv('OPENCODE_API_KEY') ?? '',
    distribution: file.distribution,
    cooldownMs: file.cooldownMs,
    codexShadowRoot: file.shadowRoot || `${CodexHomeModel.accountHome()}/.codex-dshx`,
  }
}
