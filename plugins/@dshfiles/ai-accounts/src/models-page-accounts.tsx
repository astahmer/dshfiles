import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ChevronDownIcon, PlusIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useState } from 'react'
import { AccountDraftModel } from './account-draft.js'
import { KIND_LABEL, STATE_LABEL } from './account-labels.js'
import { aiAccountsKeys, aiAccountsQueries } from './accounts-queries.js'
import { aiAccountsApi, type AccountDraft, type AccountProfile, type AccountsFile } from './api.js'
import { AutoSaveIndicator } from './auto-save-indicator.js'
import { useAutoSaver } from './auto-save.js'
import { NativeProvidersList } from './native-providers-list.js'
import { ProviderGlyph } from './provider-glyph.js'
import { usePreferences } from './use-preferences.js'
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'

/** The one credential field each kind needs to work, edited in place. */
const CREDENTIAL_FIELD = {
  codex: { key: 'homePath', label: 'CODEX_HOME', placeholder: '~/.codex' },
  'github-copilot': null,
  claude: { key: 'homePath', label: 'CLAUDE_CONFIG_DIR', placeholder: '~/.claude' },
  'opencode-go': { key: 'apiKeyEnv', label: 'Key variable', placeholder: 'OPENCODE_API_KEY' },
  commandcode: { key: 'apiKeyEnv', label: 'Key variable', placeholder: 'COMMANDCODE_API_KEY' },
  cursor: { key: 'apiKeyEnv', label: 'Token variable', placeholder: 'empty: cursor-agent login' },
} as const satisfies Record<AccountDraft['kind'], { readonly key: 'homePath' | 'apiKeyEnv'; readonly label: string; readonly placeholder: string } | null>

const QuickEditor = (props: { readonly profile: AccountProfile; readonly saveDraft: (draft: AccountDraft) => Promise<AccountsFile> }): JSX.Element => {
  const preferences = usePreferences()
  const [draft, setDraft] = useState<AccountDraft>(() => AccountDraftModel.toDraft(props.profile))
  const { saver, status } = useAutoSaver<AccountDraft>({
    save: async next => {
      await props.saveDraft(next)
    },
    equals: AccountDraftModel.sameDraft,
    delayMs: preferences.autoSaveDelayMs,
  })
  const saved = AccountDraftModel.toDraft(props.profile)
  const dirty = !AccountDraftModel.sameDraft(saved, draft)
  const problem = AccountDraftModel.draftProblem(draft)
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
      {field === null ? (
        <p className="dshx:text-xs dshx:text-muted-foreground">Manage GitHub sign-in in the full AI Accounts panel.</p>
      ) : (
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
      )}
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:sm:col-span-2">
        {preferences.saveMode === 'manual' ? (
          <>
            <Button
              disabled={!dirty || problem !== null || status.kind === 'saving'}
              onClick={() => {
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
export const ModelsPageAccounts = (props: { readonly onAddAccount: () => void }): JSX.Element | null => {
  const accounts = useApi(aiAccountsApi)
  const preferences = usePreferences()
  const queryClient = useQueryClient()
  const fileQuery = useQuery({ ...aiAccountsQueries.file(accounts), enabled: preferences.modelsPageAccounts, retry: false })
  const file = fileQuery.data ?? null
  const [expanded, setExpanded] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const setFile = (next: AccountsFile): void => {
    queryClient.setQueryData(aiAccountsKeys.file, next)
  }
  const saveMutation = useMutation({
    mutationFn: (draft: AccountDraft) => accounts.save({ draft }),
    onMutate: () => setNotice(null),
    onSuccess: setFile,
  })
  const shownNotice = notice ?? (fileQuery.isError && file === null ? 'The AI Accounts host did not answer.' : null)

  if (!preferences.modelsPageAccounts) return null

  return (
    <TooltipProvider delayDuration={500}>
      <section aria-label="AI Accounts" className="dshx-root dshx:mt-4 dshx:flex dshx:flex-col dshx:gap-2">
        <header className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
          <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
            <h3 className="dshx:text-sm dshx:font-semibold">AI Accounts</h3>
            <p className="dshx:text-xs dshx:text-muted-foreground">Subscription accounts, each its own route in the model picker.</p>
          </div>
          <Button onClick={props.onAddAccount} size="sm" type="button" variant="outline">
            <PlusIcon />
            Add account
          </Button>
        </header>
        {shownNotice === null ? null : <p className="dshx:text-xs dshx:text-destructive">{shownNotice}</p>}
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <StatusDot aria-label={profile.signedIn ? 'Signed in' : 'Not signed in'} tone={profile.signedIn ? 'success' : 'destructive'} />
                    </TooltipTrigger>
                    {(profile.signedIn ? 'Signed in' : profile.loginHint) === '' ? null : (
                      <TooltipContent>{profile.signedIn ? 'Signed in' : profile.loginHint}</TooltipContent>
                    )}
                  </Tooltip>
                  <Switch
                    aria-label={`${profile.enabled ? 'Disable' : 'Enable'} ${profile.displayName}`}
                    checked={profile.enabled}
                    onCheckedChange={enabled =>
                      void saveMutation
                        .mutateAsync({ ...AccountDraftModel.toDraft(profile), enabled })
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
                {open ? <QuickEditor profile={profile} saveDraft={draft => saveMutation.mutateAsync(draft)} /> : null}
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
    </TooltipProvider>
  )
}
