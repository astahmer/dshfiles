// Supplies the CSS-module declaration this file's stylesheet import needs.
import type {} from '@dshfiles/dshx/client'
import { AccountDetail } from './account-detail.js'
import { AccountRail } from './account-rail.js'
import { AccountsToolbar } from './accounts-toolbar.js'
import styles from './accounts.module.css'
import { useAccountsPanelState } from './use-accounts-panel-state.js'

/**
 * The accounts page, in the shape of the reference account page: a rail of
 * toggleable providers on one side, the selected provider's numbered settings
 * sections on the other, inside one bordered shell.
 *
 * Every write goes through the Host, which also owns the file, so the page and an
 * agent share one source of truth. Nothing here holds a credential: an account
 * shows whether it holds a login, who that login belongs to, and the exact
 * command that creates one.
 */
export const AccountsPanel = (props: { readonly onOpenUsageHistory: () => void }): JSX.Element => {
  const state = useAccountsPanelState()

  if (state.file === null) {
    return <div className={styles.notice}>{state.notice ?? 'Loading accounts…'}</div>
  }

  return (
    <div className={styles.page}>
      <AccountsToolbar state={state} file={state.file} />

      <div className={styles.layout}>
        <AccountRail state={state} file={state.file} />

        {state.draft !== null ? (
          <AccountDetail state={state} draft={state.draft} file={state.file} onOpenUsageHistory={props.onOpenUsageHistory} />
        ) : (
          <section className={styles.welcome}>
            <span className={styles.welcomeMark} aria-hidden>
              ✳
            </span>
            <h2>Your accounts, side by side.</h2>
            <p>Create a Codex, OpenCode Go, or Command Code profile. Each one becomes its own route in the model picker.</p>
          </section>
        )}
      </div>
    </div>
  )
}
