import type { AccountRow, AccountsSnapshot } from './api.js'

/**
 * Presentation only. Every value comes from the Host snapshot, and every action
 * is a view interaction, so this file holds no account logic of its own.
 */

const STATE_LABEL: Record<AccountRow['state'], string> = {
  healthy: 'Ready',
  cooling: 'Rate limited',
  disabled: 'Off',
}

const KIND_LABEL: Record<AccountRow['kind'], string> = {
  codex: 'Codex',
  'opencode-go': 'OpenCode Go',
}

const DISTRIBUTION_LABEL: Record<AccountsSnapshot['distribution'], string> = {
  sticky: 'Sticky — one account per conversation',
  priority: 'Priority — drain one, then the next',
  'round-robin': 'Round robin — rotate every request',
  balanced: 'Balanced — prefer the least recently used',
}

export const accountRow = (account: AccountRow): JSX.Element => {
  const cooling = account.cooldownUntil !== null
  const status = cooling ? 'Rate limited' : STATE_LABEL[account.state]
  return (
    <div className={styles.row} key={account.instanceId}>
      <div className={styles.rowMain}>
        <div className={styles.rowHead}>
          <span className={styles.kind}>{KIND_LABEL[account.kind]}</span>
          <span className={styles.name}>{account.displayName}</span>
          <span className={account.state === 'healthy' ? styles.ok : styles.warn}>
            {status}
          </span>
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>Route</dt>
            <dd>{account.instanceId}</dd>
          </div>
          <div>
            <dt>Home</dt>
            <dd title={account.effectiveHomePath}>{account.effectiveHomePath || '—'}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{account.mode === 'authOverlay' ? 'Shared state, private auth' : 'Direct'}</dd>
          </div>
          {account.identity !== null ? (
            <div>
              <dt>Account</dt>
              <dd>{account.identity}{account.plan === null ? '' : ` · ${account.plan}`}</dd>
            </div>
          ) : null}
        </dl>
        {account.signedIn ? null : (
          <p className={styles.hint}>
            {account.loginHint === '' ? 'Not configured yet.' : `Sign in with: ${account.loginHint}`}
          </p>
        )}
        {account.detail === null ? null : <p className={styles.warnText}>{account.detail}</p>}
        {cooling ? (
          <p className={styles.hint}>Available again at {new Date(account.cooldownUntil ?? 0).toLocaleTimeString()}.</p>
        ) : null}
      </div>
    </div>
  )
}

export const accountsPage = (snapshot: AccountsSnapshot): JSX.Element => (
  <div className={styles.page}>
    <header className={styles.header}>
      <div>
        <h2 className={styles.title}>AI Accounts</h2>
        <p className={styles.subtitle}>
          Every account is its own model route. Sticky keeps one account per conversation so the
          upstream prompt cache stays warm; a rate-limited account is skipped and the retry lands on
          the next one.
        </p>
      </div>
      <span className={styles.count}>{String(snapshot.accounts.length)}</span>
    </header>

    <section className={styles.distribution}>
      <h3 className={styles.sectionTitle}>Distribution</h3>
      <p className={styles.hint}>{DISTRIBUTION_LABEL[snapshot.distribution]}</p>
      <p className={styles.hint}>
        Edit <code>distribution</code> in the <code>ai-accounts</code> entry of your profile patch to
        change it. Cooldown after a rate limit: {Math.round(snapshot.cooldownMs / 1000)}s.
      </p>
    </section>

    <section>
      <h3 className={styles.sectionTitle}>Accounts</h3>
      {snapshot.accounts.length === 0 ? (
        <p className={styles.hint}>No accounts configured.</p>
      ) : (
        <div className={styles.list}>{snapshot.accounts.map(accountRow)}</div>
      )}
    </section>
  </div>
)

import styles from './accounts.module.css'