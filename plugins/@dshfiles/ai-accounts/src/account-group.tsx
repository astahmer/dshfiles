import { badgeFromName } from './account-draft.js'
import { KIND_LABEL, STATE_LABEL } from './account-labels.js'
import type { AccountProfile } from './api.js'
import styles from './accounts.module.css'

/** One group of the rail: a provider heading and the accounts under it. */
export const AccountGroup = (props: {
  readonly kind: AccountProfile['kind']
  readonly accounts: readonly AccountProfile[]
  readonly selectedId: string | null
  readonly onSelect: (instanceId: string) => void
  readonly onToggle: (profile: AccountProfile) => void
}): JSX.Element | null => {
  if (props.accounts.length === 0) return null
  return (
    <section className={styles.group}>
      <h2>{KIND_LABEL[props.kind].toUpperCase()}</h2>
      {props.accounts.map(profile => (
        <div
          className={profile.instanceId === props.selectedId ? `${styles.accountRow} ${styles.accountRowSelected}` : styles.accountRow}
          key={profile.instanceId}
        >
          <button
            type="button"
            className={styles.accountSelect}
            aria-current={profile.instanceId === props.selectedId ? 'true' : undefined}
            onClick={() => props.onSelect(profile.instanceId)}
          >
            <span className={styles.mark} style={{ background: profile.accentColor === '' ? undefined : profile.accentColor }} aria-hidden>
              {profile.badge === '' ? badgeFromName(profile.displayName).slice(0, 2) : profile.badge}
            </span>
            <span className={styles.accountCopy}>
              <strong>{profile.displayName}</strong>
              <small>{profile.identity ?? STATE_LABEL[profile.state]}</small>
            </span>
          </button>
          <label className={styles.accountToggle} title={profile.enabled ? 'Hide from the model picker' : 'Show in the model picker'}>
            <input
              type="checkbox"
              aria-label={`${profile.enabled ? 'Hide' : 'Show'} ${profile.displayName} in the model picker`}
              checked={profile.enabled}
              onChange={event => props.onToggle({ ...profile, enabled: event.target.checked })}
            />
            <span className={styles.switchTrack}>
              <span className={profile.enabled ? styles.knobOn : styles.knobOff} />
            </span>
          </label>
        </div>
      ))}
    </section>
  )
}
