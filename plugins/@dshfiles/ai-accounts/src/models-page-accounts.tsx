import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ChevronDownIcon, PlusIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useEffect, useRef, useState } from 'react'
import { draftProblem, newAccountDraft, sameDraft, toDraft } from './account-draft.js'
import { KIND_GROUPS, KIND_LABEL, STATE_LABEL } from './account-labels.js'
import { aiAccountsApi, type AccountDraft, type AccountProfile, type AccountsFile } from './api.js'
import { AutoSaveIndicator } from './auto-save-indicator.js'
import { createAutoSaver, type AutoSaveStatus, type AutoSaver } from './auto-save.js'
import { NativeProvidersList } from './native-providers-list.js'
import { ProviderGlyph } from './provider-glyph.js'
import { usePreferences } from './use-preferences.js'

/** The one credential field each kind needs to work, edited in place. */
const CREDENTIAL_FIELD = {
  codex: { key: 'homePath', label: 'CODEX_HOME', placeholder: '~/.codex' },
  claude: { key: 'homePath', label: 'CLAUDE_CONFIG_DIR', placeholder: '~/.claude' },
  'opencode-go': { key: 'apiKeyEnv', label: 'Key variable', placeholder: 'OPENCODE_API_KEY' },
  commandcode: { key: 'apiKeyEnv', label: 'Key variable', placeholder: 'COMMANDCODE_API_KEY' },
  cursor: { key: 'apiKeyEnv', label: 'Token variable', placeholder: 'empty: cursor-agent login' },
} as const satisfies Record<AccountDraft['kind'], { readonly key: 'homePath' | 'apiKeyEnv'; readonly label: string; readonly placeholder: string }>

const QuickEditor = (props: { readonly profile: AccountProfile; readonly onSaved: (file: AccountsFile) => void }): JSX.Element => {
  const accounts = useApi(aiAccountsApi)
  const preferences = usePreferences()
  const [draft, setDraft] = useState<AccountDraft>(() => toDraft(props.profile))
  const [status, setStatus] = useState<AutoSaveStatus>({ kind: 'idle' })
  const delayRef = useRef(preferences.autoSaveDelayMs)
  delayRef.current = preferences.autoSaveDelayMs
  const saverRef = useRef<AutoSaver<AccountDraft> | null>(null)
  saverRef.current ??= createAutoSaver<AccountDraft>({
    save: async next => props.onSaved(await accounts.save({ draft: next })),
    equals: sameDraft,
    onStatus: setStatus,
    delayMs: () => delayRef.current,
  })
  const saver = saverRef.current
  const saved = toDraft(props.profile)
  const dirty = !sameDraft(saved, draft)
  const problem = draftProblem(draft)
  const field = CREDENTIAL_FIELD[draft.kind]

  useEffect(() => {
    if (preferences.saveMode === 'auto' && dirty && problem === null) saver.schedule(draft)
  }, [draft, dirty, problem, preferences.saveMode, saver])

  useEffect(
    () => () => {
      void saver.flush().catch(() => undefined)
    },
    [saver],
  )

  return (
    <div className="dshx:grid dshx:gap-2 dshx:border-t dshx:px-3 dshx:py-2.5 dshx:sm:grid-cols-2">
      <label className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">
        Display name
        <Input onChange={event => setDraft({ ...draft, displayName: event.target.value })} value={draft.displayName} />
      </label>
      <label className="dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs dshx:text-muted-foreground">
        {field.label}
        <Input
          className="dshx:font-mono! dshx:text-xs"
          onChange={event => setDraft({ ...draft, [field.key]: event.target.value })}
          placeholder={field.placeholder}
          spellCheck={false}
          value={draft[field.key]}
        />
      </label>
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:sm:col-span-2">
        {preferences.saveMode === 'manual' ? (
          <>
            <Button disabled={!dirty || problem !== null || status.kind === 'saving'} onClick={() => {
                saver.schedule(draft)
                void saver.flush().catch(() => undefined)
              }}
              size="xs"
              type="button"
            >
              Save
            </Button>
            <Button disabled={!dirty} onClick={() => setDraft(saved)} size="xs" type="button" variant="outline">
              Revert
            </Button>
            <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{problem ?? (status.kind === 'error' ? status.message : '')}</span>
          </>
        ) : (
          <AutoSaveIndicator dirty={dirty} onRetry={() => void saver.retry().catch(() => undefined)} problem={problem} renamePending={false} status={status} />
        )}
      </div>
    </div>
  )
}

/**
 * AI Accounts on Settings › Models.
 *
 * DSH's provider rows are driven by settings namespaces this plugin does not
 * use (its accounts live in their own file), so the accounts appear here, in the
 * page's footer seat: one row per account with its sign-in state, the picker
 * switch, and an in-place editor for the fields that make it work.
 */
export const ModelsPageAccounts = (): JSX.Element | null => {
  const accounts = useApi(aiAccountsApi)
  const preferences = usePreferences()
  const [file, setFile] = useState<AccountsFile | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void accounts
      .read()
      .then(setFile)
      .catch(() => setNotice('The AI Accounts host did not answer.'))
  }, [accounts])

  if (!preferences.modelsPageAccounts) return null

  const create = (kind: AccountDraft['kind']): void => {
    const next = newAccountDraft({ kind, existing: file?.accounts ?? [] })
    void accounts
      .save({ draft: next })
      .then(saved => {
        setFile(saved)
        setExpanded(next.instanceId)
      })
      .catch((cause: unknown) => setNotice(`Could not add the account: ${String(cause)}`))
  }

  return (
    <section aria-label="AI Accounts" className="dshx-root dshx:mt-4 dshx:flex dshx:flex-col dshx:gap-2">
      <header className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
        <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
          <h3 className="dshx:text-sm dshx:font-semibold">AI Accounts</h3>
          <p className="dshx:text-xs dshx:text-muted-foreground">Subscription accounts, each its own route in the model picker.</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" type="button" variant="outline">
              <PlusIcon />
              Add account
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="dshx-root dshx:w-48">
            {KIND_GROUPS.map(kind => (
              <DropdownMenuItem key={kind} onSelect={() => create(kind)}>
                <ProviderGlyph kind={kind} />
                {KIND_LABEL[kind]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {notice === null ? null : <p className="dshx:text-xs dshx:text-destructive">{notice}</p>}
      <ul className="dshx:flex dshx:flex-col dshx:gap-1.5">
        {(file?.accounts ?? []).map(profile => {
          const open = expanded === profile.instanceId
          return (
            <li className="dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:bg-card" key={profile.instanceId}>
              <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2.5 dshx:px-3 dshx:py-2">
                <ProviderGlyph kind={profile.kind} />
                <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col">
                  <span className="dshx:truncate dshx:text-sm dshx:font-medium">{profile.displayName}</span>
                  <span className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
                    {KIND_LABEL[profile.kind]} · {profile.identity ?? STATE_LABEL[profile.state]}
                  </span>
                </div>
                <span
                  aria-label={profile.signedIn ? 'Signed in' : 'Not signed in'}
                  className={cn('dshx:size-2 dshx:shrink-0 dshx:rounded-full', profile.signedIn ? 'dshx:bg-success' : 'dshx:bg-destructive')}
                  role="img"
                  title={profile.signedIn ? 'Signed in' : profile.loginHint}
                />
                <Switch
                  aria-label={`${profile.enabled ? 'Disable' : 'Enable'} ${profile.displayName}`}
                  checked={profile.enabled}
                  onCheckedChange={enabled =>
                    void accounts
                      .save({ draft: { ...toDraft(profile), enabled } })
                      .then(setFile)
                      .catch((cause: unknown) => setNotice(`Could not save: ${String(cause)}`))
                  }
                  size="sm"
                />
                <Button
                  aria-expanded={open}
                  aria-label={`Edit ${profile.displayName}`}
                  onClick={() => setExpanded(open ? null : profile.instanceId)}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  Edit
                  <ChevronDownIcon className={cn('dshx:transition-transform', open && 'dshx:rotate-180')} />
                </Button>
              </div>
              {open ? <QuickEditor onSaved={setFile} profile={profile} /> : null}
            </li>
          )
        })}
      </ul>
      {file !== null && file.accounts.length === 0 ? <p className="dshx:text-xs dshx:text-muted-foreground">No accounts yet.</p> : null}
      <div className="dshx:mt-2 dshx:flex dshx:flex-col dshx:gap-1.5">
        <h4 className="dshx:text-xs dshx:font-semibold dshx:tracking-wider dshx:text-muted-foreground dshx:uppercase">Native providers</h4>
        <NativeProvidersList />
      </div>
    </section>
  )
}
