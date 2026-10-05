import { useState } from 'react'
import { AccountGroup } from './account-group.js'
import { KIND_ACCENT, KIND_GROUPS, KIND_LABEL } from './account-labels.js'
import type { AccountsFile } from './api.js'
import styles from './accounts.module.css'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

export const AccountRail = (props: { readonly state: AccountsPanelState; readonly file: AccountsFile }): JSX.Element => {
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  return (
    <aside className={styles.rail} aria-label="Provider accounts">
      <div className={styles.railHeading}>
        <span>
          YOUR ACCOUNTS <i className={styles.count}>{props.file.accounts.length}</i>
        </span>
        <span className={styles.addAnchor}>
          <button
            type="button"
            className={styles.addTrigger}
            aria-label="Add account"
            aria-expanded={addMenuOpen}
            onClick={() => setAddMenuOpen(current => !current)}
          >
            +
          </button>
          {addMenuOpen ? (
            <span className={styles.addMenu} role="menu">
              {KIND_GROUPS.map(kind => (
                <button
                  type="button"
                  role="menuitem"
                  key={kind}
                  disabled={props.state.saving}
                  onClick={() => {
                    setAddMenuOpen(false)
                    void props.state.createAccount(kind)
                  }}
                >
                  <span className={styles.addMenuMark} style={{ background: KIND_ACCENT[kind] }} aria-hidden>
                    {KIND_LABEL[kind].slice(0, 2).toUpperCase()}
                  </span>
                  {KIND_LABEL[kind]} account
                </button>
              ))}
            </span>
          ) : null}
        </span>
      </div>
      {props.file.accounts.length === 0 ? <p className={styles.empty}>Add an account to publish its own model route.</p> : null}
      {KIND_GROUPS.map(kind => (
        <AccountGroup
          kind={kind}
          accounts={props.file.accounts.filter(profile => profile.kind === kind)}
          selectedId={props.state.selectedId}
          onSelect={props.state.setSelectedId}
          onToggle={profile => void props.state.toggleEnabled(profile)}
          key={kind}
        />
      ))}
      <p className={styles.railFoot}>Credentials stay in each provider&apos;s own account directory.</p>
    </aside>
  )
}
