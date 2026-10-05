import { AccountIdentitySection } from './account-identity-section.js'
import type { AccountDraft, AccountsFile } from './api.js'
import styles from './accounts.module.css'
import { ModelCuration } from './model-curation.js'
import { Section } from './panel-primitives.js'
import { QuotaSection } from './quota-section.js'
import { RuntimePathsSection } from './runtime-paths-section.js'
import { SessionSection } from './session-section.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

export const AccountDetail = (props: {
  readonly state: AccountsPanelState
  readonly draft: AccountDraft
  readonly file: AccountsFile
  readonly onOpenUsageHistory: () => void
}): JSX.Element => {
  const draft = props.draft
  const { catalog, refreshingCatalog, refreshCatalog, selected, setDraft, persist, save, remove, dirty, saving, notice } = props.state
  const kicker = draft.kind === 'opencode-go' ? 'OPENCODE SUBSCRIPTION' : draft.kind === 'commandcode' ? 'COMMAND CODE' : 'CHATGPT SUBSCRIPTION'
  return (
    <section className={styles.detail}>
      <div className={styles.detailTop}>
        <div className={styles.detailTitleBlock}>
          <span className={styles.markLarge} style={{ background: draft.accentColor === '' ? undefined : draft.accentColor }} aria-hidden>
            {draft.badge === '' ? 'AI' : draft.badge}
          </span>
          <div>
            <p className={styles.kicker}>{kicker}</p>
            <h2>{draft.displayName || draft.instanceId}</h2>
          </div>
        </div>
        <label className={styles.switchLabel}>
          <span>{draft.enabled ? 'Enabled in model picker' : 'Hidden from model picker'}</span>
          <input type="checkbox" checked={draft.enabled} onChange={event => void persist({ enabled: event.target.checked })} />
          <span className={styles.switchTrack}>
            <span className={draft.enabled ? styles.knobOn : styles.knobOff} />
          </span>
        </label>
      </div>

      <div className={styles.detailContent}>
        <AccountIdentitySection state={props.state} draft={draft} />
        <RuntimePathsSection state={props.state} draft={draft} />
        <Section
          index="03"
          title="Models"
          action={
            <button
              type="button"
              className={styles.quiet}
              disabled={refreshingCatalog}
              onClick={() => {
                if (draft.instanceId === '') return
                void refreshCatalog(draft.instanceId)
              }}
            >
              {refreshingCatalog ? 'Checking…' : '↻ Check now'}
            </button>
          }
        >
          <span className={styles.sectionHelp}>
            Show or hide models in the picker, star the ones you reach for, and pin a default reasoning effort per model.
          </span>
          <ModelCuration account={draft} catalog={catalog?.models ?? []} onChange={next => setDraft({ ...draft, ...next })} />
        </Section>
        <QuotaSection state={props.state} />
        <SessionSection state={props.state} draft={draft} file={props.file} />
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.primary} disabled={!dirty || saving || draft.instanceId.trim().length === 0} onClick={() => void save(draft)}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className={styles.quiet} disabled={!dirty} onClick={() => setDraft(selected === null ? null : { ...selected })}>
          Revert
        </button>
        <button type="button" className={styles.quiet} onClick={props.onOpenUsageHistory}>
          Usage history
        </button>
        <span className={styles.footerNotice}>{notice ?? (dirty ? 'Unsaved changes.' : 'Provider and account are separate entries in the model picker.')}</span>
        <button type="button" className={styles.danger} onClick={() => selected !== null && void remove(selected)}>
          Remove profile
        </button>
      </footer>
    </section>
  )
}
