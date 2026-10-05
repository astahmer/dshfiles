import { badgeFromName } from './account-draft.js'
import { KIND_LABEL } from './account-labels.js'
import { PROVIDER_ICONS, type AccountDraft } from './api.js'
import styles from './accounts.module.css'
import { Field, Section } from './panel-primitives.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

/** The section a route slug is valid under, so the field explains its own rule. */
const SLUG_HINT = 'Letters, digits, dash and underscore. Appears as the provider in the model picker.'

export const AccountIdentitySection = (props: { readonly state: AccountsPanelState; readonly draft: AccountDraft }): JSX.Element => {
  const draft = props.draft
  const { accounts, selected, selectedId, setDraft, setNotice, load } = props.state
  return (
    <Section
      index="01"
      title="Account identity"
      action={
        <button
          type="button"
          className={styles.quiet}
          disabled={draft.kind !== 'codex' || selectedId === null}
          onClick={() => {
            if (selectedId === null) return
            void accounts
              .identity({ instanceId: selectedId })
              .then(identity => {
                setNotice(identity.signedIn ? 'Codex account identity refreshed.' : 'No signed-in account was found at this home yet.')
                if (identity.signedIn) void load()
              })
              .catch(() => setNotice('Could not read the Codex account identity.'))
          }}
        >
          ↻ Refresh
        </button>
      }
    >
      <div className={styles.fieldGrid}>
        <Field label="Route slug" hint={SLUG_HINT}>
          <input className={styles.input} value={draft.instanceId} onChange={event => setDraft({ ...draft, instanceId: event.target.value })} />
        </Field>
        <Field label="Display name">
          <input
            className={styles.input}
            value={draft.displayName}
            placeholder={KIND_LABEL[draft.kind]}
            onChange={event => setDraft({ ...draft, displayName: event.target.value })}
          />
        </Field>
        <Field label="Signed-in identity">
          <input
            className={styles.input}
            readOnly
            value={
              selected?.identity ??
              (draft.kind === 'codex' ? 'Sign in, then refresh' : `Key from ${draft.apiKeyEnv === '' ? 'the environment' : draft.apiKeyEnv}`)
            }
          />
        </Field>
        <Field label="Picker tag" hint="Up to 3 characters, shown on the provider mark.">
          <input
            className={styles.input}
            value={draft.badge}
            maxLength={3}
            placeholder={badgeFromName(draft.displayName)}
            onChange={event => setDraft({ ...draft, badge: event.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Tag color">
          <input
            className={styles.colorInput}
            type="color"
            value={draft.accentColor}
            onChange={event => setDraft({ ...draft, accentColor: event.target.value })}
          />
        </Field>
        <Field label="Picker icon">
          <select className={styles.input} value={draft.providerIcon} onChange={event => setDraft({ ...draft, providerIcon: event.target.value })}>
            {PROVIDER_ICONS.map(icon => (
              <option key={icon} value={icon}>
                {icon}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Section>
  )
}
