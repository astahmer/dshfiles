import type { AccountProfile, UsageCard } from './api.js'
import { readClaudeUsage, resolveClaudeConfigDir } from './claude-account.js'
import { codexLayoutFor } from './account-store.js'
import { readCommandCodeUsage } from './commandcode-usage.js'
import { readKeyFromEnv, type CredentialValueResolver } from './credentials.js'
import { readCursorUsage } from './cursor-account.js'
import { emptyUsage, readCodexUsage, readOpenCodeUsage } from './usage.js'

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
  readonly resolveCredential?: CredentialValueResolver | undefined
}): Promise<UsageCard> => {
  const { account, signal } = input
  switch (account.kind) {
    case 'codex': {
      let home: string
      try {
        home = codexLayoutFor(account, input.shadowRoot).effectiveHomePath
      } catch (cause) {
        return emptyUsage('error', cause instanceof Error ? cause.message : 'The Codex home is invalid.')
      }
      return readCodexUsage(home, signal)
    }
    case 'claude':
      return readClaudeUsage(resolveClaudeConfigDir(account.homePath), signal)
    case 'commandcode':
      return readCommandCodeUsage({ keyEnv: account.apiKeyEnv, apiBaseUrl: account.apiBaseUrl, resolveCredential: input.resolveCredential }, signal)
    case 'github-copilot':
      return emptyUsage('unsupported', 'GitHub does not expose a supported subscription quota endpoint.')
    case 'cursor':
      return readCursorUsage(account.apiKeyEnv, signal, input.resolveCredential)
    case 'opencode-go': {
      const key = input.resolveCredential === undefined ? readKeyFromEnv(account.apiKeyEnv) : await input.resolveCredential(account.apiKeyEnv)
      return readOpenCodeUsage(key, signal)
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
