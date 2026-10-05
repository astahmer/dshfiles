import type { AccountDraft } from './api.js'
import styles from './accounts.module.css'
import { Section } from './panel-primitives.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

export const RuntimePathsSection = (props: { readonly state: AccountsPanelState; readonly draft: AccountDraft }): JSX.Element => {
  const draft = props.draft
  const { setDraft, copy } = props.state
  const launchCommand =
    draft.kind === 'codex' && draft.shadowHomePath.trim() !== '' ? `CODEX_HOME='${draft.shadowHomePath.replaceAll("'", "'\\''")}' codex` : null
  return (
    <Section
      index="02"
      title="Runtime paths"
      muted="Absolute path on this host"
      action={
        launchCommand === null ? null : (
          <button
            type="button"
            className={styles.quiet}
            onClick={() => void copy(launchCommand, 'Launch command copied. Run it in a terminal to open interactive Codex for this account.')}
          >
            Copy launch command
          </button>
        )
      }
    >
      <div className={styles.pathField}>
        <span>
          {draft.kind === 'codex' ? 'CODEX_HOME' : 'API KEY'}
          <small>{draft.kind === 'codex' ? 'Shared sessions, skills and plugins.' : 'Named, never valued: the key stays in the environment.'}</small>
        </span>
        <input
          className={styles.input}
          aria-label={draft.kind === 'codex' ? 'CODEX_HOME' : 'API key environment variable'}
          spellCheck={false}
          value={draft.kind === 'codex' ? draft.homePath : draft.apiKeyEnv}
          placeholder={draft.kind === 'codex' ? '~/.codex' : 'OPENCODE_API_KEY'}
          onChange={event => setDraft(draft.kind === 'codex' ? { ...draft, homePath: event.target.value } : { ...draft, apiKeyEnv: event.target.value })}
        />
      </div>
      {draft.kind === 'codex' ? (
        <div className={styles.pathField}>
          <span>
            Shadow home
            <small>Per-account home keeping auth.json separate while sharing state.</small>
          </span>
          <input
            className={styles.input}
            aria-label="Shadow home path"
            spellCheck={false}
            value={draft.shadowHomePath}
            placeholder="Leave empty for one under the shadow root"
            onChange={event => setDraft({ ...draft, shadowHomePath: event.target.value })}
          />
        </div>
      ) : null}
      {draft.kind === 'commandcode' ? (
        <div className={styles.pathField}>
          <span>
            API base URL
            <small>Leave empty for Command Code&apos;s own deployment.</small>
          </span>
          <input
            className={styles.input}
            aria-label="API base URL"
            spellCheck={false}
            value={draft.apiBaseUrl}
            placeholder="https://api.commandcode.ai"
            onChange={event => setDraft({ ...draft, apiBaseUrl: event.target.value })}
          />
        </div>
      ) : null}
    </Section>
  )
}
