import type { AccountProfile, UsageCard } from './api.js'
import { ClaudeAccountModel, claudeAccountService } from './claude-account.js'
import { AccountStoreModel } from './account-store.js'
import { readCommandCodeUsage } from './commandcode-usage.js'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { readCopilotUsage } from './copilot-quota.js'
import { CredentialModel, type CredentialValueResolver } from './credentials.js'
import { readCursorUsage } from './cursor-account.js'
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
        home = AccountStoreModel.codexLayoutFor(account, input.shadowRoot).effectiveHomePath
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
    case 'opencode-go': {
      const key = input.resolveCredential === undefined ? CredentialModel.readKeyFromEnv(account.apiKeyEnv) : await input.resolveCredential(account.apiKeyEnv)
      return readOpenCodeUsage(key, signal, input.onAuthenticated)
    }
  }
}

/**
 * Share one sweep between every surface that asks within `ttlMs`: the page,
 * the sidebar footer and the edge overlay each poll, and without this each
 * would make its own authenticated request per account per minute.
 */
export const createUsageCache = <Value>(input: { readonly ttlMs: number; readonly read: () => Promise<Value>; readonly now?: () => number }) => {
  const now = input.now ?? Date.now
  let cached: { readonly at: number; readonly value: Value } | undefined
  let inFlight: Promise<Value> | undefined
  const refresh = (): Promise<Value> => {
    if (inFlight !== undefined) return inFlight
    const pending = input
      .read()
      .then(value => {
        cached = { at: now(), value }
        return value
      })
      .finally(() => {
        if (inFlight === pending) inFlight = undefined
      })
    inFlight = pending
    return pending
  }
  return {
    /** The last sweep, however old, without starting a new one. */
    latest: (): Value | undefined => cached?.value,
    invalidate: (): void => {
      cached = undefined
    },
    get: (): Promise<Value> => (cached !== undefined && now() - cached.at < input.ttlMs ? Promise.resolve(cached.value) : refresh()),
    refresh,
  }
}
