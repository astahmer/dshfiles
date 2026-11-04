import type { AccountProfile, UsageCard } from './api.js'
import { ClaudeAccountModel, claudeAccountService } from './claude-account.js'
import { AccountHomePolicy } from './account-home-policy.js'
import { readCommandCodeUsage } from './commandcode-usage.js'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { readCopilotUsage } from './copilot-quota.js'
import { CredentialModel, type CredentialValueResolver } from './credentials.js'
import { readCursorUsage } from './cursor-account.js'
import { MistralAccountModel } from './mistral-account.js'
import { ProviderUsageModel, readCodexUsage, readOpenCodeUsage } from './usage.js'

/**
 * One account's live quota, read with that account's own credential. The page,
 * the footer and the history recorder all go through here, so a provider is
 * read one way everywhere.
 */
export const readAccountUsage = async (input: {
  readonly account: AccountProfile
  /** The file's shadow root: an account with no explicit shadow home reads the one its route uses. */
  readonly shadowRoot: string
  readonly signal?: AbortSignal | undefined
  /** Private per-read evidence; never inferred from a card or replayed from cache. */
  readonly onAuthenticated?: (() => void) | undefined
  readonly resolveCredential?: CredentialValueResolver | undefined
  /** The Copilot account's stored OAuth grant. */
  readonly readCopilotCredential?: ((instanceId: string) => Promise<OAuthCredential | undefined>) | undefined
}): Promise<UsageCard> => {
  const { account, signal } = input
  switch (account.kind) {
    case 'codex': {
      let home: string
      try {
        home = AccountHomePolicy.codexLayoutFor(account, input.shadowRoot).effectiveHomePath
      } catch (cause) {
        return ProviderUsageModel.emptyUsage('error', cause instanceof Error ? cause.message : 'The Codex home is invalid.')
      }
      return readCodexUsage(home, signal, input.onAuthenticated)
    }
    case 'claude':
      return claudeAccountService.readUsage(ClaudeAccountModel.resolveClaudeConfigDir(account.homePath), signal, input.onAuthenticated)
    case 'commandcode':
      return readCommandCodeUsage(
        {
          keyEnv: account.apiKeyEnv,
          apiBaseUrl: account.apiBaseUrl,
          resolveCredential: input.resolveCredential,
          onAuthenticated: input.onAuthenticated,
          authSource: account.authSource,
        },
        signal,
      )
    case 'github-copilot':
      return readCopilotUsage({ credential: await input.readCopilotCredential?.(account.instanceId), signal, onAuthenticated: input.onAuthenticated })
    case 'cursor':
      return readCursorUsage(account.apiKeyEnv, signal, input.resolveCredential, input.onAuthenticated, account.authSource)
    case 'mistral':
      return MistralAccountModel.readUsage({
        keyEnv: account.apiKeyEnv,
        authSource: account.authSource,
        resolveCredential: input.resolveCredential,
        onAuthenticated: input.onAuthenticated,
        signal,
      })
    case 'opencode-go': {
      const key = input.resolveCredential === undefined ? CredentialModel.readKeyFromEnv(account.apiKeyEnv) : await input.resolveCredential(account.apiKeyEnv)
      return readOpenCodeUsage(key, signal, input.onAuthenticated)
    }
  }
}
