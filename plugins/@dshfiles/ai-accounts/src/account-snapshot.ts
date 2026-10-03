import {
  describeCodexAuth,
  resolveCodexHomeLayout,
  type CodexHomeLayout,
} from './codex-home.js'
import type { AccountStatus } from './account-pool.js'
import type { AccountRow, AccountsSnapshot } from './api.js'
import type { AiAccountsConfig, CodexAccountConfig } from './host.js'

/**
 * The account table the settings page renders.
 *
 * One place builds it, so the page and any agent tool observe the same facts:
 * the pool's health, plus each Codex home's login state read from Codex's own
 * `auth.json`. Never returns a token, and never writes one — Codex owns
 * sign-in and refresh.
 */
export const buildAccountsSnapshot = async (params: {
  readonly config: AiAccountsConfig
  readonly statuses: readonly AccountStatus[]
  readonly distributions: readonly [AccountsSnapshot['distribution'], ...AccountsSnapshot['distribution'][]]
}): Promise<AccountsSnapshot> => {
  const rows: AccountRow[] = []

  for (const status of params.statuses) {
    if (status.kind !== 'codex') {
      rows.push({
        instanceId: status.id,
        kind: 'opencode-go',
        displayName: status.label,
        enabled: status.enabled,
        mode: 'direct',
        sharedHomePath: '',
        effectiveHomePath: '',
        loginHint: 'Set OPENCODE_API_KEY, or ai-accounts.opencodeApiKey in cordis.patch.yml.',
        signedIn: params.config.opencodeApiKey.trim().length > 0,
        identity: null,
        plan: null,
        state: status.state,
        cooldownUntil: status.cooldownUntil ?? null,
        detail: null,
      })
      continue
    }

    const account = findCodexAccount(params.config, status.id)
    const layout = account === undefined ? undefined : layoutFor(account, params.config)
    const auth = layout === undefined ? undefined : await describeCodexAuth(layout)
    rows.push({
      instanceId: status.id,
      kind: 'codex',
      displayName: status.label,
      enabled: status.enabled,
      mode: layout?.mode ?? 'direct',
      sharedHomePath: layout?.sharedHomePath ?? '',
      effectiveHomePath: layout?.effectiveHomePath ?? '',
      loginHint: layout === undefined ? '' : loginCommandFor(layout),
      signedIn: auth?.signedIn ?? false,
      identity: auth?.identity ?? null,
      plan: auth?.plan ?? null,
      state: status.state,
      cooldownUntil: status.cooldownUntil ?? null,
      detail: auth?.error ?? null,
    })
  }

  return {
    distribution: params.config.distribution,
    distributions: [...params.distributions],
    cooldownMs: params.config.cooldownMs,
    accounts: rows,
  }
}

const findCodexAccount = (
  config: AiAccountsConfig,
  instanceId: string,
): CodexAccountConfig | undefined =>
  config.codexAccounts.find(
    account =>
      (account.instanceId.trim().length === 0 ? 'codex' : account.instanceId.trim()) === instanceId,
  )

const layoutFor = (account: CodexAccountConfig, config: AiAccountsConfig): CodexHomeLayout =>
  resolveCodexHomeLayout({
    homePath: account.homePath,
    shadowHomePath:
      account.shadowHomePath.trim().length > 0
        ? account.shadowHomePath
        : `${config.codexShadowRoot.replace(/\/$/, '')}/${account.instanceId.trim().length > 0 ? account.instanceId.trim() : 'codex'}`,
  })

const loginCommandFor = (layout: CodexHomeLayout): string =>
  `CODEX_HOME="${layout.effectiveHomePath}" codex login`