import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { CopyIcon } from '@dshfiles/plugin-ui/icons'
import type { AccountDraft } from './api.js'
import { NumberedSection } from './panel-primitives.js'
import type { AccountsPanelState } from './use-accounts-panel-state.js'

const PathField = (props: {
  readonly label: string
  readonly hint: string
  readonly ariaLabel: string
  readonly value: string
  readonly placeholder: string
  readonly onChange: (value: string) => void
}): JSX.Element => (
  <div className="dshx:grid dshx:grid-cols-1 dshx:items-center dshx:gap-2 dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3 dshx:md:grid-cols-[minmax(170px,0.48fr)_minmax(0,1fr)] dshx:md:gap-3.5">
    <span className="dshx:flex dshx:flex-col dshx:gap-1">
      <span className="dshx:text-sm dshx:font-medium">{props.label}</span>
      <small className="dshx:text-xs dshx:text-muted-foreground">{props.hint}</small>
    </span>
    <Input
      aria-label={props.ariaLabel}
      className="dshx:font-mono! dshx:text-xs"
      onChange={event => props.onChange(event.target.value)}
      placeholder={props.placeholder}
      spellCheck={false}
      value={props.value}
    />
  </div>
)

export const RuntimePathsSection = (props: { readonly state: AccountsPanelState; readonly draft: AccountDraft }): JSX.Element => {
  const draft = props.draft
  const { setDraft, copy } = props.state
  const launchCommand =
    draft.kind === 'codex' && draft.shadowHomePath.trim() !== '' ? `CODEX_HOME='${draft.shadowHomePath.replaceAll("'", "'\\''")}' codex` : null
  return (
    <NumberedSection
      actions={
        launchCommand === null ? null : (
          <Button
            onClick={() => void copy(launchCommand, 'Launch command copied. Run it in a terminal to open interactive Codex for this account.')}
            size="xs"
            type="button"
            variant="outline"
          >
            <CopyIcon />
            Copy launch command
          </Button>
        )
      }
      description="Absolute path on this host"
      index="02"
      title="Runtime paths"
    >
      <PathField
        ariaLabel={draft.kind === 'codex' ? 'CODEX_HOME' : 'API key environment variable'}
        hint={draft.kind === 'codex' ? 'Shared sessions, skills and plugins.' : 'Named, never valued: the key stays in the environment.'}
        label={draft.kind === 'codex' ? 'CODEX_HOME' : 'API KEY'}
        onChange={value => setDraft(draft.kind === 'codex' ? { ...draft, homePath: value } : { ...draft, apiKeyEnv: value })}
        placeholder={draft.kind === 'codex' ? '~/.codex' : 'OPENCODE_API_KEY'}
        value={draft.kind === 'codex' ? draft.homePath : draft.apiKeyEnv}
      />
      {draft.kind === 'codex' ? (
        <PathField
          ariaLabel="Shadow home path"
          hint="Per-account home keeping auth.json separate while sharing state."
          label="Shadow home"
          onChange={value => setDraft({ ...draft, shadowHomePath: value })}
          placeholder="Leave empty for one under the shadow root"
          value={draft.shadowHomePath}
        />
      ) : null}
      {draft.kind === 'commandcode' ? (
        <PathField
          ariaLabel="API base URL"
          hint="Leave empty for Command Code's own deployment."
          label="API base URL"
          onChange={value => setDraft({ ...draft, apiBaseUrl: value })}
          placeholder="https://api.commandcode.ai"
          value={draft.apiBaseUrl}
        />
      ) : null}
    </NumberedSection>
  )
}
