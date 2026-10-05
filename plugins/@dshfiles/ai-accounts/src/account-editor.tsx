import {
  Button,
  IconCopyOutlineRegular,
  IconRefreshOutlineRegular,
  IconRightUpOutlineRegular,
  IconTrashOutlineRegular,
  Input,
  Switch,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
import { ConfirmDialog, Field, Notice, Section, Select, fieldControlClassName } from '@dshfiles/plugin-ui'
import { useAppForm, useStore } from '@dshfiles/plugin-ui/form'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { KIND_LABEL, ROUTE_SLUG_HINT, accountEditorSchema, badgeFromName, sameDraft, toDraft } from './account-draft.js'
import { accountsKeys, useAccountsFileWriter, useQuotaHistory, useRecordUsage } from './accounts-queries.js'
import { PROVIDER_ICONS, aiAccountsApi, type AccountDraft, type AccountProfile, type AccountsFile, type UsageCard } from './api.js'
import { ModelCuration, type CurationPatch } from './model-curation.js'
import { QuotaHistoryChart } from './quota-history-chart.js'
import { quotaTone } from './quota-tone.js'
import styles from './accounts.module.css'

const STATE_LABEL: Record<AccountProfile['state'], string> = {
  healthy: 'Authenticated',
  cooling: 'Rate limited',
  disabled: 'Off',
  unconfigured: 'Not signed in',
}

const DISTRIBUTION_HINT: Record<AccountsFile['distribution'], string> = {
  sticky: 'One account per conversation, so the upstream prompt cache stays warm. A rate-limited account is skipped and the retry lands on the next one.',
  priority: 'Drain one account until it is rate-limited, then the next in order.',
  'round-robin': 'Rotate on every request so spend spreads evenly.',
  balanced: 'Weighted random, biased toward the least recently used account.',
}

const HISTORY_RANGE_OPTIONS = [1, 3, 7, 14, 30].map(days => ({ value: String(days), label: `${String(days)}d` }))

const PROVIDER_ICON_OPTIONS = PROVIDER_ICONS.map(icon => ({ value: icon, label: icon }))

/** How long an unsigned Codex account waits between identity checks. */
const SIGN_IN_POLL_MS = 2_500

const formatReset = (resetsAt: number | null): string | null => {
  if (resetsAt === null || Number.isNaN(resetsAt)) return null
  const minutes = Math.max(0, Math.round((resetsAt - Date.now()) / 60_000))
  if (minutes < 60) return `Resets in ${String(minutes)}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `Resets in ${String(hours)}h`
  return `Resets in ${String(Math.round(hours / 24))}d`
}

const UsageCardView = (props: { readonly usage: UsageCard | undefined }): JSX.Element | null => {
  const usage = props.usage
  if (usage === undefined || usage.status !== 'ok' || usage.windows.length === 0) return null
  const earliestExpiry = usage.bankedResetExpiries.filter((expiresAt): expiresAt is number => expiresAt !== null).sort((left, right) => left - right)[0]
  return (
    <div className={styles.inset}>
      {usage.windows.map(window => (
        <div className={styles.usageWindow} key={window.label}>
          <div className={styles.usageRow}>
            <span>{window.label}</span>
            <strong>{window.percentRemaining}% left</strong>
          </div>
          <div className={styles.quotaTrack}>
            <span className={styles.quotaFill} data-tone={quotaTone(window.percentRemaining)} style={{ width: `${String(Math.max(0, Math.min(100, window.percentRemaining)))}%` }} />
          </div>
          {formatReset(window.resetsAt) === null ? null : <small>{formatReset(window.resetsAt)}</small>}
        </div>
      ))}
      {usage.bankedResets > 0 ? (
        <small>
          {String(usage.bankedResets)} banked reset{usage.bankedResets === 1 ? '' : 's'}
          {earliestExpiry === undefined ? '' : ` · earliest expires ${new Date(earliestExpiry).toLocaleDateString()}`}
        </small>
      ) : null}
    </div>
  )
}

/** One numbered section, the shape the reference page numbers 01–05. */
const NumberedSection = (props: { readonly index: string; readonly title: string; readonly description?: string; readonly actions?: ReactNode; readonly children: ReactNode }): JSX.Element => (
  <Section
    actions={props.actions}
    className={styles.section}
    description={props.description}
    title={
      <>
        <span className={styles.sectionIndex}>{props.index}</span>
        {props.title}
      </>
    }
  >
    {props.children}
  </Section>
)

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
  const launchCommand = draft.kind === 'codex' && draft.shadowHomePath.trim() !== '' ? `CODEX_HOME='${draft.shadowHomePath.replaceAll("'", "'\\''")}' codex` : null
  const enabled = persistEnabled.isPending ? persistEnabled.variables : draft.enabled
  const enabledLabel = enabled ? 'Enabled in model picker' : 'Hidden from model picker'

  return (
    <section className={styles.detail}>
      <form className={styles.detailForm} onSubmit={submit}>
        <div className={styles.detailTop}>
          <div className={styles.detailTitleBlock}>
            <span aria-hidden className={styles.markLarge} style={{ background: draft.accentColor === '' ? undefined : draft.accentColor }}>
              {draft.badge === '' ? 'AI' : draft.badge}
            </span>
            <div>
              <p className={styles.kicker}>{kicker}</p>
              <h2>{draft.displayName || draft.instanceId}</h2>
            </div>
          </div>
          <span className={styles.switchRow}>
            <span aria-hidden>{enabledLabel}</span>
            <Switch checked={enabled} disabled={persistEnabled.isPending} label={enabledLabel} onChange={next => persistEnabled.mutate(next)} />
          </span>
        </div>

        <div className={styles.detailContent}>
          <NumberedSection
            actions={
              <Button
                disabled={draft.kind !== 'codex' || refreshIdentity.isPending}
                icon={<IconRefreshOutlineRegular />}
                onClick={() => refreshIdentity.mutate()}
                size="sm"
                type="button"
                variant="outline"
              >
                Refresh
              </Button>
            }
            index="01"
            title="Account identity"
          >
            <div className={styles.fieldGrid}>
              <form.AppField name="instanceId">{field => <field.TextField description={ROUTE_SLUG_HINT} label="Route slug" required />}</form.AppField>
              <form.AppField name="displayName">{field => <field.TextField label="Display name" placeholder={KIND_LABEL[draft.kind]} required />}</form.AppField>
              <Field label="Signed-in identity">
                {control => (
                  <Input
                    {...control}
                    readOnly
                    value={props.account.identity ?? (draft.kind === 'codex' ? 'Sign in, then refresh' : `Key from ${draft.apiKeyEnv === '' ? 'the environment' : draft.apiKeyEnv}`)}
                  />
                )}
              </Field>
              <form.AppField name="badge">
                {field => (
                  <Field description="Up to 3 characters, shown on the provider mark." label="Picker tag">
                    {control => (
                      <Input
                        {...control}
                        maxLength={3}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={event => field.handleChange(event.currentTarget.value.toUpperCase())}
                        placeholder={badgeFromName(draft.displayName)}
                        value={field.state.value}
                      />
                    )}
                  </Field>
                )}
              </form.AppField>
              <form.AppField name="accentColor">
                {field => (
                  <Field label="Tag color">
                    {control => (
                      <input
                        {...control}
                        className={`${fieldControlClassName} ${styles.colorInput}`}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={event => field.handleChange(event.currentTarget.value)}
                        type="color"
                        value={field.state.value}
                      />
                    )}
                  </Field>
                )}
              </form.AppField>
              <form.AppField name="providerIcon">{field => <field.SelectField label="Picker icon" options={PROVIDER_ICON_OPTIONS} />}</form.AppField>
            </div>
          </NumberedSection>

          <NumberedSection
            actions={
              launchCommand === null ? undefined : (
                <Button
                  icon={<IconCopyOutlineRegular />}
                  onClick={() => void copy(launchCommand, 'Launch command copied. Run it in a terminal to open interactive Codex for this account.')}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Copy launch command
                </Button>
              )
            }
            description="Absolute path on this host"
            index="02"
            title="Runtime paths"
          >
            <div className={styles.fieldStack}>
              {draft.kind === 'codex' ? (
                <>
                  <form.AppField name="homePath">
                    {field => <field.TextField description="Shared sessions, skills and plugins." label="CODEX_HOME" placeholder="~/.codex" />}
                  </form.AppField>
                  <form.AppField name="shadowHomePath">
                    {field => (
                      <field.TextField
                        description="Per-account home keeping auth.json separate while sharing state."
                        label="Shadow home path"
                        placeholder="Leave empty for one under the shadow root"
                      />
                    )}
                  </form.AppField>
                </>
              ) : (
                <form.AppField name="apiKeyEnv">
                  {field => (
                    <field.TextField
                      description="Named, never valued: the key stays in the environment."
                      label="API key environment variable"
                      placeholder="OPENCODE_API_KEY"
                    />
                  )}
                </form.AppField>
              )}
              {draft.kind === 'commandcode' ? (
                <form.AppField name="apiBaseUrl">
                  {field => (
                    <field.TextField
                      description="Leave empty for Command Code's own deployment."
                      label="API base URL"
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
              <Button disabled={catalog.isFetching} icon={<IconRefreshOutlineRegular />} onClick={() => void catalog.refetch()} size="sm" type="button" variant="outline">
                {catalog.isFetching ? 'Checking…' : 'Check now'}
              </Button>
            }
            description="Show or hide models in the picker, star the ones you reach for, and pin a default reasoning effort per model."
            index="03"
            title="Models"
          >
            <ModelCuration account={draft} catalog={catalog.data?.models ?? []} onChange={applyCuration} />
          </NumberedSection>

          <NumberedSection
            actions={
              <>
                <Select
                  aria-label="History range"
                  className={styles.compactSelect}
                  onValueChange={days => setHistoryDays(Number(days))}
                  options={HISTORY_RANGE_OPTIONS}
                  value={String(historyDays)}
                />
                <Button
                  disabled={recordUsage.isPending}
                  onClick={() => recordUsage.mutate(undefined, { onError: () => onNotice('Could not record usage right now.') })}
                  size="sm"
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
              className={styles.inset}
              emptyMessage="Not enough history yet. Quota is recorded on an interval; check back shortly."
              height={140}
              points={history.data?.points ?? []}
            />
          </NumberedSection>

          <NumberedSection
            actions={
              props.account.signedIn ? undefined : (
                <Button icon={<IconCopyOutlineRegular />} onClick={() => void copy(props.account.loginHint, 'Sign-in command copied.')} size="sm" type="button" variant="outline">
                  Copy sign-in command
                </Button>
              )
            }
            index="05"
            title="Session"
          >
            <dl className={styles.factGrid}>
              <div>
                <dt>Route</dt>
                <dd>{draft.instanceId}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{draft.kind === 'codex' ? (draft.shadowHomePath === '' ? 'Shared auth' : 'Shared state, private auth') : 'Key from the environment'}</dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>{props.account.identity ?? STATE_LABEL[props.account.state]}</dd>
              </div>
            </dl>
            <p className={styles.muted}>
              Requests spread by <strong>{props.distribution}</strong>. {DISTRIBUTION_HINT[props.distribution]}
            </p>
            {props.account.signedIn ? null : (
              <Notice title="Sign in with">
                <code className={styles.code}>{props.account.loginHint}</code>
              </Notice>
            )}
            {props.account.detail === null ? null : <Notice tone="warning">{props.account.detail}</Notice>}
          </NumberedSection>
        </div>

        <footer className={styles.footer}>
          <form.Subscribe selector={state => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <Button disabled={!dirty || !canSubmit || isSubmitting} type="submit" variant="primary">
                {isSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
            )}
          </form.Subscribe>
          <Button disabled={!dirty} onClick={() => form.reset(saved)} type="button" variant="outline">
            Revert
          </Button>
          <Button icon={<IconRightUpOutlineRegular />} onClick={props.onOpenUsageHistory} type="button">
            Usage history
          </Button>
          <span className={styles.footerNotice} role="status">
            {props.notice ?? (dirty ? 'Unsaved changes.' : 'Provider and account are separate entries in the model picker.')}
          </span>
          <Button icon={<IconTrashOutlineRegular />} onClick={() => setConfirmingRemove(true)} type="button" variant="outline">
            Remove profile
          </Button>
        </footer>
      </form>
      <ConfirmDialog
        busy={remove.isPending}
        cancelLabel="Cancel"
        closeLabel="Close"
        confirmLabel="Remove profile"
        description="The route leaves the model picker. Credentials stay on disk."
        onCancel={() => setConfirmingRemove(false)}
        onConfirm={() => remove.mutate()}
        open={confirmingRemove}
        title={`Remove ${props.account.displayName}?`}
        tone="danger"
      />
    </section>
  )
}
