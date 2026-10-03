import { useApiQuery } from '@becomeopc/dshx/client'
import { aiAccountsApi, type AccountsSnapshot } from './api.js'
import { accountsPage } from './accounts-view.js'
import styles from './accounts.module.css'

const EMPTY: AccountsSnapshot = {
  distribution: 'sticky',
  distributions: ['sticky', 'priority', 'round-robin', 'balanced'],
  cooldownMs: 0,
  accounts: [],
}

/**
 * Settings section: one settings page per list entry, so this is a whole page
 * rather than a single preference row under General.
 */
export const AccountsSection = (): JSX.Element => {
  const query = useApiQuery(aiAccountsApi, 'snapshot')
  if (query.status === 'error') {
    return (
      <div className={styles.error}>
        The account host did not answer: {query.error.message}. Is the <code>ai-accounts</code>{' '}
        bundle enabled in this profile?
      </div>
    )
  }
  if (query.status === 'pending') return <div className={styles.error}>Loading accounts…</div>
  return accountsPage(query.data ?? EMPTY)
}
