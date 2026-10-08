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

const KEY_FIELD = {
  codex: null,
  claude: {
    label: 'SETUP TOKEN',
    hint: 'Optional variable holding a `claude setup-token` value, used for requests before the login.',
    placeholder: 'CLAUDE_WORK_API_KEY',
  },
  'opencode-go': { label: 'API KEY', hint: 'Named, never valued: the key stays in the environment.', placeholder: 'OPENCODE_API_KEY' },
  commandcode: { label: 'API KEY', hint: 'Named, never valued. Empty falls back to `cmd login`.', placeholder: 'COMMANDCODE_API_KEY' },
  cursor: { label: 'ACCESS TOKEN', hint: 'Optional variable holding a Cursor token. Empty uses the `cursor-agent login`.', placeholder: 'CURSOR_WORK_API_KEY' },
} satisfies Record<AccountDraft['kind'], { readonly label: string; readonly hint: string; readonly placeholder: string } | null>

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

const launchCommandFor = (draft: AccountDraft): string | null => {
  if (draft.kind === 'codex' && draft.shadowHomePath.trim() !== '') return `CODEX_HOME=${shellQuote(draft.shadowHomePath)} codex`
  if (draft.kind === 'claude' && draft.homePath.trim() !== '') return `CLAUDE_CONFIG_DIR=${shellQuote(draft.homePath)} claude`
  return null
}

export const RuntimePathsSection = (props: { readonly state: AccountsPanelState; readonly draft: AccountDraft }): JSX.Element => {
  const draft = props.draft
  const { setDraft, copy } = props.state
  const launchCommand = launchCommandFor(draft)
  const keyField = KEY_FIELD[draft.kind]
  return (
    <NumberedSection
      actions={
        launchCommand === null ? null : (
          <Button
            onClick={() => void copy(launchCommand, 'Launch command copied. Run it in a terminal to open this account interactively.')}
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
      {draft.kind === 'codex' ? (
        <>
          <PathField
            ariaLabel="CODEX_HOME"
            hint="Shared sessions, skills and plugins."
            label="CODEX_HOME"
            onChange={homePath => setDraft({ ...draft, homePath })}
            placeholder="~/.codex"
            value={draft.homePath}
          />
          <PathField
            ariaLabel="Shadow home path"
            hint="Per-account home keeping auth.json separate while sharing state."
            label="Shadow home"
            onChange={shadowHomePath => setDraft({ ...draft, shadowHomePath })}
            placeholder="Leave empty for one under the shadow root"
            value={draft.shadowHomePath}
          />
        </>
      ) : null}
      {draft.kind === 'claude' ? (
        <PathField
          ariaLabel="CLAUDE_CONFIG_DIR"
          hint="Where Claude Code keeps this account's login. One directory per account."
          label="CLAUDE_CONFIG_DIR"
          onChange={homePath => setDraft({ ...draft, homePath })}
          placeholder="~/.claude"
          value={draft.homePath}
        />
      ) : null}
      {keyField === null ? null : (
        <PathField
          ariaLabel={`${keyField.label} environment variable`}
          hint={keyField.hint}
          label={keyField.label}
          onChange={apiKeyEnv => setDraft({ ...draft, apiKeyEnv })}
          placeholder={keyField.placeholder}
          value={draft.apiKeyEnv}
        />
      )}
      {draft.kind === 'commandcode' ? (
        <PathField
          ariaLabel="API base URL"
          hint="Leave empty for Command Code's own deployment."
          label="API base URL"
          onChange={apiBaseUrl => setDraft({ ...draft, apiBaseUrl })}
          placeholder="https://api.commandcode.ai"
          value={draft.apiBaseUrl}
        />
      ) : null}
    </NumberedSection>
  )
}
