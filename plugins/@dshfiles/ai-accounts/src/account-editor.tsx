import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { useAppForm, useStore } from '@dshfiles/plugin-ui/form'
import { Alert, AlertDescription, AlertTitle } from '@dshfiles/plugin-ui/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ArrowUpRightIcon, CopyIcon, ExternalLinkIcon, RefreshCwIcon, Trash2Icon, TriangleAlertIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { KIND_LABEL, ROUTE_SLUG_HINT, accountEditorSchema, badgeFromName, sameDraft, toDraft } from './account-draft.js'
import { DISTRIBUTION_HINT, STATE_LABEL } from './account-labels.js'
import { accountsKeys, useAccountsFileWriter, useQuotaHistory, useRecordUsage } from './accounts-queries.js'
import { PROVIDER_ICONS, aiAccountsApi, type AccountDraft, type AccountProfile, type AccountsFile, type UsageCard } from './api.js'
import { ModelCuration, type CurationPatch } from './model-curation.js'
import { LabelledControl, NumberedSection, ProviderMark } from './panel-primitives.js'
import { QuotaHistoryChart } from './quota-history-chart.js'
import { UsageCardView } from './usage-card-view.js'

const HISTORY_RANGES = [1, 3, 7, 14, 30] as const

/** Kit `Field` drops its vertical layout (unprefixed classes), so form fields restate the column. */
const FORM_FIELD_CLASS = 'dshx:flex-col dshx:gap-1.5'

const PROVIDER_ICON_OPTIONS = PROVIDER_ICONS.map(icon => ({ value: icon, label: icon }))

/** How long an unsigned Codex account waits between identity checks. */
const SIGN_IN_POLL_MS = 2_500

/**
 * The selected account's numbered settings. Keyed by account, so switching the
 * selection starts a fresh form; while untouched the form follows re-reads, and
 * once edited it keeps the edits until saved or reverted.
 */
export const AccountEditor = (props: {
  readonly account: AccountProfile
  readonly distribution: AccountsFile['distribution']
  readonly usage: UsageCard | undefined
  readonly notice: string | null
  readonly onNotice: (message: string | null) => void
  readonly onSelect: (instanceId: string | null) => void
  readonly onOpenUsageHistory: () => void
}): JSX.Element => {
  const api = useApi(aiAccountsApi)
  const queryClient = useQueryClient()
  const writeFile = useAccountsFileWriter()
  const instanceId = props.account.instanceId
  const saved = useMemo(() => toDraft(props.account), [props.account])
  const [historyDays, setHistoryDays] = useState(7)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const enabledSwitchId = useId()
  const { onNotice } = props

  const save = useMutation({ mutationFn: (draft: AccountDraft) => api.save({ draft }), onSuccess: writeFile })

  const form = useAppForm({
    defaultValues: saved,
    validators: { onChange: accountEditorSchema },
    onSubmit: async ({ value, formApi }) => {
      onNotice(null)
      try {
        await save.mutateAsync(value)
        formApi.reset(value)
        props.onSelect(value.instanceId)
        onNotice('Saved. New sessions use the updated route settings.')
      } catch (error) {
        onNotice(`Could not save: ${errorMessage(error, 'the Host refused the account.')}`)
      }
    },
  })
  const draft = useStore(form.store, state => state.values)
  const dirty = !sameDraft(saved, draft)

  /** The header switch writes straight through, so the form only mirrors it. */
  const persistEnabled = useMutation({
    mutationFn: (enabled: boolean) => api.save({ draft: { ...saved, enabled } }),
    onSuccess: writeFile,
    onError: error => onNotice(`Could not save: ${errorMessage(error, 'the Host refused the account.')}`),
  })
  useEffect(() => {
    if (form.getFieldValue('enabled') !== props.account.enabled) form.setFieldValue('enabled', props.account.enabled, { dontUpdateMeta: true })
  }, [form, props.account.enabled])

  const catalog = useQuery({ queryKey: accountsKeys.catalogFor(instanceId), queryFn: ({ signal }) => api.catalog({ instanceId }, { signal }) })
  const history = useQuotaHistory({ instanceId, days: historyDays })
  const recordUsage = useRecordUsage()

  /**
   * While a Codex account has no login, poll for one: the user signs in with
   * the command shown, and the card refreshes as soon as Codex writes the file.
   */
  const awaitingSignIn = props.account.kind === 'codex' && !props.account.signedIn
  const signInPoll = useQuery({
    queryKey: accountsKeys.identityFor(instanceId),
    queryFn: ({ signal }) => api.identity({ instanceId }, { signal }),
    enabled: awaitingSignIn,
    refetchInterval: SIGN_IN_POLL_MS,
  })
  const signedInNow = awaitingSignIn && signInPoll.data?.signedIn === true
  useEffect(() => {
    if (signedInNow) void queryClient.invalidateQueries({ queryKey: accountsKeys.file })
  }, [queryClient, signedInNow])

  const refreshIdentity = useMutation({
    mutationFn: () => api.identity({ instanceId }),
    onSuccess: identity => {
      onNotice(identity.signedIn ? 'Codex account identity refreshed.' : 'No signed-in account was found at this home yet.')
      if (identity.signedIn) void queryClient.invalidateQueries({ queryKey: accountsKeys.file })
    },
    onError: () => onNotice('Could not read the Codex account identity.'),
  })

  const remove = useMutation({
    mutationFn: () => api.remove({ instanceId }),
    onSuccess: file => {
      writeFile(file)
      setConfirmingRemove(false)
      props.onSelect(null)
      onNotice(`Removed ${props.account.displayName}. Credentials were left on disk.`)
    },
    onError: error => onNotice(`Could not remove the account: ${errorMessage(error, 'the Host refused the removal.')}`),
  })

  const copy = async (text: string, message: string): Promise<void> => {
    onNotice((await writeClipboard(text)) ? message : `Copy this into a terminal: ${text}`)
  }

  const applyCuration = (patch: CurationPatch): void => {
    if (patch.hiddenModelIds !== undefined) form.setFieldValue('hiddenModelIds', patch.hiddenModelIds)
    if (patch.favoriteModelIds !== undefined) form.setFieldValue('favoriteModelIds', patch.favoriteModelIds)
    if (patch.modelOrder !== undefined) form.setFieldValue('modelOrder', patch.modelOrder)
    if (patch.reasoningDefaults !== undefined) form.setFieldValue('reasoningDefaults', patch.reasoningDefaults)
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void form.handleSubmit()
  }

  const kicker = draft.kind === 'opencode-go' ? 'OPENCODE SUBSCRIPTION' : draft.kind === 'commandcode' ? 'COMMAND CODE' : 'CHATGPT SUBSCRIPTION'
  const launchCommand =
    draft.kind === 'codex' && draft.shadowHomePath.trim() !== '' ? `CODEX_HOME='${draft.shadowHomePath.replaceAll("'", "'\\''")}' codex` : null
  const enabled = persistEnabled.isPending ? persistEnabled.variables : draft.enabled
  const enabledLabel = enabled ? 'Enabled in model picker' : 'Hidden from model picker'

  return (
    <section className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-col dshx:overflow-hidden dshx:px-5 dshx:py-3.5">
      <form className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col" onSubmit={submit}>
        <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3.5 dshx:border-b dshx:pb-3">
          <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-3">
            <ProviderMark badge={draft.badge === '' ? 'AI' : draft.badge} color={draft.accentColor} size="lg" />
            <div className="dshx:min-w-0">
              <p className="dshx:text-[11px] dshx:font-semibold dshx:tracking-widest dshx:text-muted-foreground">{kicker}</p>
              <h2 className="dshx:truncate dshx:text-lg dshx:font-semibold dshx:tracking-tight">{draft.displayName || draft.instanceId}</h2>
            </div>
          </div>
          <div className="dshx:flex dshx:items-center dshx:gap-2.5">
            <Label className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground" htmlFor={enabledSwitchId}>
              {enabledLabel}
            </Label>
            <Switch checked={enabled} disabled={persistEnabled.isPending} id={enabledSwitchId} onCheckedChange={next => persistEnabled.mutate(next)} />
          </div>
        </header>

        <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:overflow-auto dshx:overscroll-contain dshx:pr-1">
          <NumberedSection
            actions={
              <Button
                disabled={draft.kind !== 'codex' || refreshIdentity.isPending}
                onClick={() => refreshIdentity.mutate()}
                size="xs"
                type="button"
                variant="outline"
              >
                <RefreshCwIcon />
                Refresh
              </Button>
            }
            index="01"
            title="Account identity"
          >
            <div className="dshx:grid dshx:grid-cols-1 dshx:gap-x-3 dshx:gap-y-2.5 dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3 dshx:md:grid-cols-2">
              <form.AppField name="instanceId">
                {field => <field.TextField className={FORM_FIELD_CLASS} description={ROUTE_SLUG_HINT} label="Route slug" required />}
              </form.AppField>
              <form.AppField name="displayName">
                {field => <field.TextField className={FORM_FIELD_CLASS} label="Display name" placeholder={KIND_LABEL[draft.kind]} required />}
              </form.AppField>
              <LabelledControl label="Signed-in identity">
                {id => (
                  <Input
                    className="dshx:text-muted-foreground"
                    id={id}
                    readOnly
                    value={
                      props.account.identity ??
                      (draft.kind === 'codex' ? 'Sign in, then refresh' : `Key from ${draft.apiKeyEnv === '' ? 'the environment' : draft.apiKeyEnv}`)
                    }
                  />
                )}
              </LabelledControl>
              <form.AppField name="badge">
                {field => (
                  <LabelledControl hint="Up to 3 characters, shown on the provider mark." label="Picker tag">
                    {id => (
                      <Input
                        id={id}
                        maxLength={3}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={event => field.handleChange(event.currentTarget.value.toUpperCase())}
                        placeholder={badgeFromName(draft.displayName)}
                        value={field.state.value}
                      />
                    )}
                  </LabelledControl>
                )}
              </form.AppField>
              <form.AppField name="accentColor">
                {field => (
                  <LabelledControl label="Tag color">
                    {id => (
                      <Input
                        className="dshx:w-14! dshx:cursor-pointer dshx:p-1"
                        id={id}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={event => field.handleChange(event.currentTarget.value)}
                        type="color"
                        value={field.state.value}
                      />
                    )}
                  </LabelledControl>
                )}
              </form.AppField>
              <form.AppField name="providerIcon">
                {field => <field.SelectField className={FORM_FIELD_CLASS} label="Picker icon" options={PROVIDER_ICON_OPTIONS} />}
              </form.AppField>
            </div>
          </NumberedSection>

          <NumberedSection
            actions={
              launchCommand === null ? undefined : (
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
            <div className="dshx:flex dshx:flex-col dshx:gap-2.5 dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3">
              {draft.kind === 'codex' ? (
                <>
                  <form.AppField name="homePath">
                    {field => (
                      <field.TextField
                        className={FORM_FIELD_CLASS}
                        description="Shared sessions, skills and plugins."
                        label="CODEX_HOME"
                        monospace
                        placeholder="~/.codex"
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="shadowHomePath">
                    {field => (
                      <field.TextField
                        className={FORM_FIELD_CLASS}
                        description="Per-account home keeping auth.json separate while sharing state."
                        label="Shadow home path"
                        monospace
                        placeholder="Leave empty for one under the shadow root"
                      />
                    )}
                  </form.AppField>
                </>
              ) : (
                <form.AppField name="apiKeyEnv">
                  {field => (
                    <field.TextField
                      className={FORM_FIELD_CLASS}
                      description="Named, never valued: the key stays in the environment."
                      label="API key environment variable"
                      monospace
                      placeholder="OPENCODE_API_KEY"
                    />
                  )}
                </form.AppField>
              )}
              {draft.kind === 'commandcode' ? (
                <form.AppField name="apiBaseUrl">
                  {field => (
                    <field.TextField
                      className={FORM_FIELD_CLASS}
                      description="Leave empty for Command Code's own deployment."
                      label="API base URL"
                      monospace
                      placeholder="https://api.commandcode.ai"
                      type="url"
                    />
                  )}
                </form.AppField>
              ) : null}
            </div>
          </NumberedSection>

          <NumberedSection
            actions={
              <Button disabled={catalog.isFetching} onClick={() => void catalog.refetch()} size="xs" type="button" variant="outline">
                <RefreshCwIcon />
                {catalog.isFetching ? 'Checking…' : 'Check now'}
              </Button>
            }
            index="03"
            title="Models"
          >
            <p className="dshx:text-xs dshx:text-muted-foreground">
              Show or hide models in the picker, star the ones you reach for, and pin a default reasoning effort per model.
            </p>
            <ModelCuration account={draft} catalog={catalog.data?.models ?? []} onChange={applyCuration} />
          </NumberedSection>

          <NumberedSection
            actions={
              <>
                <Select onValueChange={days => setHistoryDays(Number(days))} value={String(historyDays)}>
                  <SelectTrigger aria-label="History range" className="dshx:h-6 dshx:text-xs" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HISTORY_RANGES.map(days => (
                      <SelectItem key={days} value={String(days)}>
                        {days}d
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={recordUsage.isPending}
                  onClick={() => recordUsage.mutate(undefined, { onError: () => onNotice('Could not record usage right now.') })}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  Record now
                </Button>
              </>
            }
            index="04"
            title="Quota"
          >
            <UsageCardView usage={props.usage} />
            <QuotaHistoryChart
              ariaLabel={`Remaining quota over the last ${String(historyDays)} days`}
              emptyMessage="Not enough history yet. Quota is recorded on an interval; check back shortly."
              height={160}
              points={history.data?.points ?? []}
            />
          </NumberedSection>

          <NumberedSection
            actions={
              props.account.signedIn ? undefined : (
                <Button onClick={() => void copy(props.account.loginHint, 'Sign-in command copied.')} size="xs" type="button" variant="outline">
                  <ExternalLinkIcon />
                  Copy sign-in command
                </Button>
              )
            }
            index="05"
            title="Session"
          >
            <dl className="dshx:grid dshx:grid-cols-1 dshx:gap-3 dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-3 dshx:md:grid-cols-3">
              <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
                <dt className="dshx:text-xs dshx:text-muted-foreground">Route</dt>
                <dd className="dshx:truncate dshx:font-mono dshx:text-xs">{draft.instanceId}</dd>
              </div>
              <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
                <dt className="dshx:text-xs dshx:text-muted-foreground">Mode</dt>
                <dd className="dshx:truncate dshx:text-sm">
                  {draft.kind === 'codex' ? (draft.shadowHomePath === '' ? 'Shared auth' : 'Shared state, private auth') : 'Key from the environment'}
                </dd>
              </div>
              <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1">
                <dt className="dshx:text-xs dshx:text-muted-foreground">Account</dt>
                <dd className="dshx:truncate dshx:text-sm">{props.account.identity ?? STATE_LABEL[props.account.state]}</dd>
              </div>
            </dl>
            <p className="dshx:text-xs dshx:text-muted-foreground">
              Requests spread by <strong className="dshx:font-semibold dshx:text-foreground">{props.distribution}</strong>.{' '}
              {DISTRIBUTION_HINT[props.distribution]}
            </p>
            {props.account.signedIn ? null : (
              <Alert role="status" variant="info">
                <AlertTitle>Sign in with</AlertTitle>
                <AlertDescription>
                  <code className="dshx:font-mono dshx:text-xs dshx:break-all">{props.account.loginHint}</code>
                </AlertDescription>
              </Alert>
            )}
            {props.account.detail === null ? null : (
              <Alert variant="warning">
                <TriangleAlertIcon />
                <AlertDescription>{props.account.detail}</AlertDescription>
              </Alert>
            )}
          </NumberedSection>
        </div>

        <footer className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-t dshx:pt-3">
          <form.Subscribe selector={state => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <Button disabled={!dirty || !canSubmit || isSubmitting} size="sm" type="submit">
                {isSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
            )}
          </form.Subscribe>
          <Button disabled={!dirty} onClick={() => form.reset(saved)} size="sm" type="button" variant="outline">
            Revert
          </Button>
          <Button onClick={props.onOpenUsageHistory} size="sm" type="button" variant="ghost">
            <ArrowUpRightIcon />
            Usage history
          </Button>
          <span className="dshx:min-w-40 dshx:flex-1 dshx:text-xs dshx:text-muted-foreground" role="status">
            {props.notice ?? (dirty ? 'Unsaved changes.' : 'Provider and account are separate entries in the model picker.')}
          </span>
          <Button
            className="dshx:text-destructive dshx:hover:text-destructive"
            onClick={() => setConfirmingRemove(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2Icon />
            Remove profile
          </Button>
        </footer>
      </form>
      <AlertDialog onOpenChange={open => setConfirmingRemove(open || remove.isPending)} open={confirmingRemove}>
        <AlertDialogContent className="dshx-root" size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {props.account.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>The route leaves the model picker. Credentials stay on disk.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={event => {
                event.preventDefault()
                remove.mutate()
              }}
              variant="destructive"
            >
              Remove profile
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
