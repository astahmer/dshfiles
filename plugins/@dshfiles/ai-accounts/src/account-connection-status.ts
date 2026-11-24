import type { Health } from '@dshfiles/plugin-ui/components/ui/status-dot'
import type { AccountProfile, AccountsUsage } from './api.js'

/** Local credentials are not a token-validity probe. Only authenticated provider data earns Connected. */
const accountConnectionStatus = (account: AccountProfile, usage: AccountsUsage | null) => {
  const card = usage?.cards.find(item => item.instanceId === account.instanceId)
  // The card's own read time: a reading kept through a failed read was not checked by the latest sweep.
  const checkedAt = card === undefined ? null : (card.usage.readAt ?? usage?.readAt ?? null)
  // Saved credentials the provider rejected are an expired sign-in (red); no credentials at all is simply off.
  if (card?.usage.status === 'unauthenticated')
    return account.signedIn
      ? {
          label: 'Sign-in expired',
          tone: 'muted' as const,
          health: 'down' as const satisfies Health,
          detail: card.usage.message,
          checkedAt,
          authenticated: false,
        }
      : { label: 'Not signed in', tone: 'muted' as const, health: 'off' as const satisfies Health, detail: card.usage.message, checkedAt, authenticated: false }
  // A spent plan that may not draw extra usage is unavailable on purpose, not rate-limited.
  if (account.state === 'exhausted')
    return {
      label: 'Plan limits spent',
      tone: 'warning' as const,
      health: 'limited' as const satisfies Health,
      detail: 'Extra usage is off for this account: routing skips it until the plan window resets. Turn on “Use extra usage” in its settings to draw overage.',
      checkedAt,
      authenticated: false,
    }
  // Current routing health wins over a previously authenticated quota reading.
  if (account.state === 'cooling' || card?.usage.status === 'rate-limited')
    return {
      label: 'Rate limited',
      tone: 'warning' as const,
      health: 'limited' as const satisfies Health,
      detail: account.detail ?? card?.usage.message ?? null,
      checkedAt,
      authenticated: false,
    }
  if (card?.usage.status === 'ok')
    return {
      label: 'Connected',
      tone: 'success' as const,
      health: 'ok' as const satisfies Health,
      detail: 'Authenticated provider quota response.',
      checkedAt,
      authenticated: true,
    }
  return {
    label: account.signedIn ? 'Credentials available' : 'Not signed in',
    tone: 'muted' as const,
    health: 'off' as const satisfies Health,
    detail: card?.usage.message ?? account.detail,
    checkedAt,
    authenticated: false,
  }
}

type ConnectionStatus = ReturnType<typeof accountConnectionStatus>
const clockTime = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/**
 * The one line of state in the account header, drawn after its health dot ("Connected · checked 03:18 PM"). The
 * text is muted while healthy and takes the dot's colour when the account is limited or down.
 */
const accountStateLine = (status: ConnectionStatus, time: (at: number) => string = clockTime) => {
  const checked = status.checkedAt === null ? null : time(status.checkedAt)
  return { text: checked === null ? status.label : `${status.label} · checked ${checked}`, health: status.health }
}

const accountAuthenticationLabel = (account: Pick<AccountProfile, 'kind' | 'apiKeyEnv' | 'authSource'>): string => {
  if (account.kind === 'codex') return 'ChatGPT (OAuth)'
  if (account.kind === 'github-copilot') return 'GitHub (OAuth)'
  if (account.kind === 'antigravity') return 'Antigravity CLI login'
  if (account.authSource === 'cli') return account.kind === 'claude' ? 'Claude Code subscription' : 'CLI login'
  if (account.apiKeyEnv !== '') return 'Credential reference'
  if (account.kind === 'claude') return 'Claude Code subscription'
  return 'Provider login'
}

/** How an account's connection reads in the accounts page: its status, header line and sign-in method. */
export class AccountConnection {
  static readonly status = accountConnectionStatus
  static readonly stateLine = accountStateLine
  static readonly authenticationLabel = accountAuthenticationLabel
}

export type AccountSection = 'models' | 'settings' | 'usage'
