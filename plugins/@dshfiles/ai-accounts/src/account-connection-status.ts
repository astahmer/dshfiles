import type { AccountProfile, AccountsUsage } from './api.js'

/** Local credentials are not a token-validity probe. Only authenticated provider data earns Connected. */
export const accountConnectionStatus = (account: AccountProfile, usage: AccountsUsage | null) => {
  const card = usage?.cards.find(item => item.instanceId === account.instanceId)
  if (card?.usage.status === 'unauthenticated')
    return { label: 'Not signed in', tone: 'muted' as const, detail: card.usage.message, checkedAt: usage?.readAt ?? null, authenticated: false }
  // Current routing health wins over a previously authenticated quota reading.
  if (account.state === 'cooling' || card?.usage.status === 'rate-limited')
    return {
      label: 'Rate limited',
      tone: 'warning' as const,
      detail: account.detail ?? card?.usage.message ?? null,
      checkedAt: card === undefined ? null : (usage?.readAt ?? null),
      authenticated: false,
    }
  if (card?.usage.status === 'ok')
    return {
      label: 'Connected',
      tone: 'success' as const,
      detail: 'Authenticated provider quota response.',
      checkedAt: usage?.readAt ?? null,
      authenticated: true,
    }
  return {
    label: account.signedIn ? 'Credentials available' : 'Not signed in',
    tone: 'muted' as const,
    detail: card?.usage.message ?? account.detail,
    checkedAt: card === undefined ? null : (usage?.readAt ?? null),
    authenticated: false,
  }
}

export const accountAuthenticationLabel = (account: Pick<AccountProfile, 'kind' | 'apiKeyEnv' | 'authSource'>): string => {
  if (account.kind === 'codex') return 'ChatGPT (OAuth)'
  if (account.kind === 'github-copilot') return 'GitHub (OAuth)'
  if (account.authSource === 'cli') return account.kind === 'claude' ? 'Claude Code subscription' : 'CLI login'
  if (account.apiKeyEnv !== '') return 'Credential reference'
  if (account.kind === 'claude') return 'Claude Code subscription'
  return 'Provider login'
}

export type AccountSection = 'models' | 'settings' | 'usage'
