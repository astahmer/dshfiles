import { DISTRIBUTION_HINT, STATE_LABEL } from './account-labels.js'
import type { AccountDraft, AccountsFile } from './api.js'
import styles from './accounts.module.css'
import { Section } from './panel-primitives.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

export const SessionSection = (props: { readonly state: AccountsPanelState; readonly draft: AccountDraft; readonly file: AccountsFile }): JSX.Element => {
  const draft = props.draft
  const file = props.file
  const { selected, copy } = props.state
  return (
    <Section
      index="05"
      title="Session"
      action={
        selected === null || selected.signedIn ? null : (
          <button type="button" className={styles.quiet} onClick={() => void copy(selected.loginHint, 'Sign-in command copied.')}>
            ↗ Copy sign-in command
          </button>
        )
      }
    >
      <div className={styles.factGrid}>
        <div>
          <span className={styles.factLabel}>Route</span>
          <span className={styles.factValue}>{draft.instanceId}</span>
        </div>
        <div>
          <span className={styles.factLabel}>Mode</span>
          <span className={styles.factValue}>
            {draft.kind === 'codex' ? (draft.shadowHomePath === '' ? 'Shared auth' : 'Shared state, private auth') : 'Key from the environment'}
          </span>
        </div>
        <div>
          <span className={styles.factLabel}>Account</span>
          <span className={styles.factValue}>{selected?.identity ?? STATE_LABEL[selected?.state ?? 'unconfigured']}</span>
        </div>
      </div>
      <p className={styles.spreadingNote}>
        Requests spread by <strong>{file.distribution}</strong>. {DISTRIBUTION_HINT[file.distribution]}
      </p>
      {selected !== null && !selected.signedIn ? (
        <div className={styles.loginHint}>
          <span>Sign in with</span>
          <code>{selected.loginHint}</code>
        </div>
      ) : null}
      {selected?.detail == null ? null : <p className={styles.warnText}>{selected.detail}</p>}
    </Section>
  )
}
