import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { CopyIcon } from '@dshfiles/plugin-ui/icons'
import { useState } from 'react'
import type { WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { ApiKeySetupDialog } from './api-key-setup-dialog.js'
import { isKeyEnvName, type AccountDraft } from './api.js'
import { NumberedSection } from './panel-primitives.js'
import { shouldOfferCredentialSetup } from './credential-setup-model.js'
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
    hint: 'Optional `claude setup-token` reference. The value stays in DSH credentials or the Host environment.',
    placeholder: 'CLAUDE_WORK_API_KEY',
  },
  'opencode-go': { label: 'API KEY', hint: 'Name the key reference; the value stays in DSH credentials or the Host environment.', placeholder: 'OPENCODE_API_KEY' },
  commandcode: { label: 'API KEY', hint: 'Name the key reference; empty falls back to `cmd login`.', placeholder: 'COMMANDCODE_API_KEY' },
  cursor: { label: 'ACCESS TOKEN', hint: 'Optional token reference. Empty uses the `cursor-agent login`.', placeholder: 'CURSOR_WORK_API_KEY' },
} satisfies Record<AccountDraft['kind'], { readonly label: string; readonly hint: string; readonly placeholder: string } | null>

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

const launchCommandFor = (draft: AccountDraft): string | null => {
  if (draft.kind === 'codex' && draft.shadowHomePath.trim() !== '') return `CODEX_HOME=${shellQuote(draft.shadowHomePath)} codex`
  if (draft.kind === 'claude' && draft.homePath.trim() !== '') return `CLAUDE_CONFIG_DIR=${shellQuote(draft.homePath)} claude`
  return null
}

export const RuntimePathsSection = (props: {
  readonly state: AccountsPanelState
  readonly draft: AccountDraft
  readonly folderPicker: WorkspacePickerPorts
}): JSX.Element => {
  const draft = props.draft
  const { setDraft, copy } = props.state
  const [configureOpen, setConfigureOpen] = useState(false)
  const launchCommand = launchCommandFor(draft)
  const keyField = KEY_FIELD[draft.kind]
  const credentialRef = draft.apiKeyEnv.trim()
  const credentialInfo = props.state.credentialInfo
  const showConfigureKey = shouldOfferCredentialSetup({
    setupAvailable: props.state.credentialSetupAvailable,
    draftInstanceId: draft.instanceId,
    selectedInstanceId: props.state.selected?.instanceId,
    selectedSignedIn: props.state.selected?.signedIn,
    apiKeyEnv: credentialRef,
    credentialInfo,
  })
  const credentialStatus =
    !isKeyEnvName(credentialRef)
      ? 'Name a variable ending in _API_KEY; the secret value does not belong in account JSON.'
      : props.state.credentialInfoLoading
        ? 'Checking credential status…'
        : credentialInfo?.configured === true
          ? credentialInfo.source === 'env'
            ? 'Available from the process environment. Restart DSH after changing that environment value.'
            : `Available from ${credentialInfo.source ?? 'a DSH credential source'}; changes apply to the next request without a relaunch.`
          : credentialInfo?.configured === false && !credentialInfo.writable
            ? 'This variable is supplied by a read-only source. Change that source; process-environment changes need a DSH relaunch.'
            : credentialInfo?.configured === false
              ? 'No key is configured for this reference.'
              : props.state.credentialInfoUnavailable
                ? 'Credential status is unavailable. Use the Host environment or enable DSH credential management.'
                : 'Credential status is not available yet.'
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
        <>
          <PathField
            ariaLabel={`${keyField.label} environment variable`}
            hint={keyField.hint}
            label={keyField.label}
            onChange={apiKeyEnv => setDraft({ ...draft, apiKeyEnv })}
            placeholder={keyField.placeholder}
            value={draft.apiKeyEnv}
          />
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3 dshx:px-1">
            <p className="dshx:text-xs dshx:text-muted-foreground">{credentialStatus}</p>
            {showConfigureKey ? (
              <Button onClick={() => setConfigureOpen(true)} size="sm" type="button" variant="outline">
                Configure key…
              </Button>
            ) : null}
          </div>
          <ApiKeySetupDialog draft={draft} folderPicker={props.folderPicker} onOpenChange={setConfigureOpen} open={configureOpen} state={props.state} />
        </>
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
