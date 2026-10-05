import { DISTRIBUTIONS } from './account-labels.js'
import type { AccountsFile } from './api.js'
import styles from './accounts.module.css'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

export const AccountsToolbar = (props: { readonly state: AccountsPanelState; readonly file: AccountsFile }): JSX.Element => (
  <header className={styles.toolbar}>
    <span className={styles.scopeBar}>
      <span>Applying settings for</span>
      <span className={styles.scopeValue}>All accounts</span>
      <span>on</span>
      <span className={styles.scopeValue}>this host</span>
    </span>
    <label className={styles.overlaySwitch}>
      <input
        type="checkbox"
        checked={props.state.overlays.edgeWidget}
        onChange={event => void props.state.persistOverlay({ edgeWidget: event.target.checked })}
      />
      <span>Edge overlay</span>
    </label>
    <label className={styles.overlaySwitch}>
      <input
        type="checkbox"
        checked={props.state.overlays.footerQuota}
        onChange={event => void props.state.persistOverlay({ footerQuota: event.target.checked })}
      />
      <span>Sidebar foot</span>
    </label>
    <span className={styles.scopeBar}>
      <span>Spreading requests</span>
      <select
        className={styles.scopeSelect}
        value={props.file.distribution}
        aria-label="Request distribution"
        onChange={event => {
          const distribution = DISTRIBUTIONS.find(value => value === event.target.value)
          if (distribution === undefined) return
          void props.state.accounts
            .setDistribution({ distribution })
            .then(props.state.setFile)
            .catch(error => props.state.setNotice(`Could not change distribution: ${String(error)}`))
        }}
      >
        {DISTRIBUTIONS.map(value => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </span>
  </header>
)
