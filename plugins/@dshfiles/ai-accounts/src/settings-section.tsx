import { useApi } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@dshfiles/plugin-ui/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { ArrowUpRightIcon, RefreshCwIcon } from '@dshfiles/plugin-ui/icons'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { aiAccountsKeys, aiAccountsQueries } from './accounts-queries.js'
import { DISTRIBUTION_HINT, DISTRIBUTION_LABEL, DISTRIBUTIONS } from './account-labels.js'
import { aiAccountsApi, type AccountsFile, type UsageHistoryMeta } from './api.js'
import { FAILURE_KINDS, type FailureKind, type KindPolicy } from './failure-policy.js'
import { pricingStatusLine } from './pricing-status.js'
import { usePreferences } from './use-preferences.js'

const DELAYS = [400, 800, 1_500, 3_000] as const
const REFRESH_SECONDS = [15, 30, 60, 120, 300, 900] as const
const INTERVAL_MINUTES = [1, 2, 5, 10, 15, 30, 60] as const
const RETENTION_DAYS = [30, 90, 180, 365] as const
const PRICING_REFRESH_HOURS = [6, 12, 24, 48, 168] as const
const METER_LABELS = [
  { value: 'both', label: '% left and reset' },
  { value: 'percent', label: '% left' },
  { value: 'reset', label: 'Time to reset' },
] as const
const USAGE_WINDOW_LAYOUTS = [
  { value: 'binding', label: 'Most relevant window' },
  { value: 'horizontal', label: 'All windows horizontally' },
  { value: 'vertical', label: 'All windows vertically' },
] as const

const RETRY_COUNTS = [0, 1, 2, 3, 5] as const
const BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000] as const
const WAIT_SECONDS = [0, 30, 60, 120, 300, 900] as const

const FAILURE_KIND_COPY: Readonly<Record<FailureKind, { readonly title: string; readonly hint: string; readonly options: readonly (keyof KindPolicy)[] }>> = {
  transport: {
    title: 'Connection failure',
    hint: 'Resets, timeouts, 5xx, and Codex replay-buffer overflows.',
    options: ['retries', 'backoffMs', 'failover', 'shrink', 'then'],
  },
  rateLimit: { title: 'Rate limited', hint: 'The provider answered 429.', options: ['retries', 'backoffMs', 'failover', 'waitSeconds', 'then'] },
  exhausted: { title: 'Usage exhausted', hint: 'No quota left, or the weekly limit is spent.', options: ['lunaReserve', 'failover', 'waitSeconds', 'then'] },
  auth: { title: 'Sign-in failure', hint: 'Signed out, rejected or missing credentials.', options: ['retries', 'failover', 'then'] },
  oversized: { title: 'Request too large', hint: 'Context overflow or an oversized body; DSH compaction handles overflow.', options: ['shrink', 'then'] },
}

const formatDuration = (milliseconds: number): string =>
  milliseconds < 1_000 ? `${String(milliseconds)} ms` : milliseconds < 60_000 ? `${String(milliseconds / 1_000)} s` : `${String(milliseconds / 60_000)} min`

const OVERRIDE_LINE = /^\s*(\S+\/\S+)\s*=\s*(.+?)\s*$/

const overridesToText = (overrides: Readonly<Record<string, string>>): string =>
  Object.entries(overrides)
    .map(([route, value]) => `${route} = ${value}`)
    .join('\n')

/** One `provider/model = value` rule per line; blank and malformed lines are dropped. */
const textToOverrides = (text: string): { readonly overrides: Record<string, string>; readonly skipped: number } => {
  const overrides: Record<string, string> = {}
  let skipped = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const match = OVERRIDE_LINE.exec(line)
    if (match?.[1] === undefined || match[2] === undefined) skipped += 1
    else overrides[match[1]] = match[2]
  }
  return { overrides, skipped }
}

const Group = (props: { readonly title: string; readonly description?: string; readonly children: ReactNode }): JSX.Element => (
  <section className="dshx:flex dshx:flex-col dshx:gap-3 dshx:rounded-lg dshx:border dshx:bg-card dshx:p-4">
    <header className="dshx:flex dshx:flex-col dshx:gap-0.5">
      <h3 className="dshx:text-sm dshx:font-semibold">{props.title}</h3>
      {props.description === undefined ? null : <p className="dshx:text-xs dshx:text-muted-foreground">{props.description}</p>}
    </header>
    {props.children}
  </section>
)

const Row = (props: { readonly label: string; readonly hint?: string; readonly children: (id: string) => ReactNode }): JSX.Element => {
  const id = useId()
  return (
    <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-x-4 dshx:gap-y-1.5">
      <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:basis-56 dshx:flex-col dshx:gap-0.5">
        <Label className="dshx:text-sm dshx:font-normal" htmlFor={id}>
          {props.label}
        </Label>
        {props.hint === undefined ? null : <p className="dshx:text-xs dshx:text-muted-foreground">{props.hint}</p>}
      </div>
      {props.children(id)}
    </div>
  )
}

const NumberSelect = (props: {
  readonly id: string
  readonly value: number
  readonly options: readonly number[]
  readonly format: (value: number) => string
  readonly disabled?: boolean
  readonly onChange: (value: number) => void
}): JSX.Element => {
  const options = props.options.includes(props.value) ? props.options : [...props.options, props.value].sort((left, right) => left - right)
  return (
    <Select disabled={props.disabled} onValueChange={value => props.onChange(Number(value))} value={String(props.value)}>
      <SelectTrigger className="dshx:w-36" id={props.id} size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option} value={String(option)}>
            {props.format(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * AI Accounts in DSH Settings: how the accounts page saves, which quota
 * surfaces draw, and the Host's history schedule. Account profiles themselves
 * are edited on the AI Accounts page (and on Settings › Models).
 */
export const AiAccountsSettingsSection = (props: { readonly close: () => void; readonly openAccounts: () => void }): JSX.Element => {
  const accounts = useApi(aiAccountsApi)
  const preferences = usePreferences()
  const settings = preferences.settings
  const [history, setHistory] = useState<UsageHistoryMeta | null>(null)
  const [file, setFile] = useState<AccountsFile | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const saveModeId = useId()

  useEffect(() => {
    void accounts
      .historySettings()
      .then(setHistory)
      .catch(() => setNotice('The account host did not answer.'))
    void accounts
      .read()
      .then(setFile)
      .catch(() => undefined)
  }, [accounts])

  const write = (task: Promise<unknown>): void => {
    setNotice(null)
    void task.catch((cause: unknown) => setNotice(`Could not save: ${cause instanceof Error ? cause.message : String(cause)}`))
  }

  const saveHistory = (patch: Partial<Pick<UsageHistoryMeta, 'intervalMinutes' | 'retentionDays'>>): void => {
    if (history === null) return
    write(
      accounts
        .saveHistorySettings({ intervalMinutes: patch.intervalMinutes ?? history.intervalMinutes, retentionDays: patch.retentionDays ?? history.retentionDays })
        .then(setHistory),
    )
  }

  const readOnly = !settings.writable

  return (
    <div className="dshx-root dshx:flex dshx:min-h-0 dshx:flex-col dshx:gap-4 dshx:overflow-y-auto dshx:pb-4">
      <header className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-3">
        <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
          <h2 className="dshx:text-base dshx:font-semibold">AI Accounts</h2>
          <p className="dshx:text-xs dshx:text-muted-foreground">Codex, Claude, OpenCode Go, Command Code and Cursor accounts side by side.</p>
        </div>
        <Button
          onClick={() => {
            props.close()
            props.openAccounts()
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <ArrowUpRightIcon />
          Open AI Accounts
        </Button>
      </header>

      {settings.error?.kind === 'namespace-unregistered' || settings.error?.kind === 'provider-unavailable' ? (
        <Alert variant="warning">
          <AlertDescription>Restart DSH to load these preferences; the running Host predates them. Defaults apply until then.</AlertDescription>
        </Alert>
      ) : readOnly && settings.status === 'ready' ? (
        <Alert variant="warning">
          <AlertDescription>These preferences are read-only in this browser.</AlertDescription>
        </Alert>
      ) : null}
      {notice === null ? null : (
        <Alert role="status" variant="info">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <Group description="How edits on the accounts page are written." title="Editing">
        <RadioGroup
          aria-labelledby={saveModeId}
          className="dshx:flex dshx:flex-col dshx:gap-2"
          disabled={readOnly}
          onValueChange={value => write(settings.set('saveMode', value === 'manual' ? 'manual' : 'auto'))}
          value={preferences.saveMode}
        >
          <span className="dshx:sr-only" id={saveModeId}>
            Save mode
          </span>
          {(
            [
              ['auto', 'Automatic', 'Each edit saves itself after a short pause, with a saved/saving indicator.'],
              ['manual', 'Manual', 'Edits wait for Save changes; Revert discards them.'],
            ] as const
          ).map(([value, label, hint]) => (
            <Label className="dshx:flex dshx:items-start dshx:gap-2.5 dshx:font-normal" key={value}>
              <RadioGroupItem className="dshx:mt-0.5" value={value} />
              <span className="dshx:flex dshx:flex-col dshx:gap-0.5">
                <span className="dshx:text-sm">{label}</span>
                <span className="dshx:text-xs dshx:text-muted-foreground">{hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        <Row hint="Pause after the last change before an automatic save." label="Auto-save delay">
          {id => (
            <NumberSelect
              disabled={readOnly || preferences.saveMode === 'manual'}
              format={value => (value < 1_000 ? `${String(value)} ms` : `${String(value / 1_000)} s`)}
              id={id}
              onChange={value => write(settings.set('autoSaveDelayMs', value))}
              options={DELAYS}
              value={preferences.autoSaveDelayMs}
            />
          )}
        </Row>
        {file === null ? null : (
          <Row hint={DISTRIBUTION_HINT[file.distribution]} label="Spread requests">
            {id => (
              <Select
                onValueChange={value => {
                  const distribution = DISTRIBUTIONS.find(candidate => candidate === value)
                  if (distribution !== undefined) write(accounts.setDistribution({ distribution }).then(setFile))
                }}
                value={file.distribution}
              >
                <SelectTrigger className="dshx:w-36" id={id} size="sm">
                  <SelectValue>{DISTRIBUTION_LABEL[file.distribution]}</SelectValue>
                </SelectTrigger>
                <SelectContent className="dshx:w-80 dshx:max-w-[calc(100vw-2rem)]">
                  {DISTRIBUTIONS.map(value => (
                    <SelectItem className="dshx:items-start dshx:py-2" key={value} value={value}>
                      <span className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5">
                        <span>{DISTRIBUTION_LABEL[value]}</span>
                        <span className="dshx:whitespace-normal dshx:text-xs dshx:text-muted-foreground">{DISTRIBUTION_HINT[value]}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Row>
        )}
        <Row
          hint="Once a Codex account's weekly limit is spent, send its requests to Luna Reserve (gpt-reserve) while the reserve lasts, like the Codex app's “Continue with Luna Reserve”."
          label="Codex Luna Reserve"
        >
          {id => (
            <Switch
              checked={preferences.codexLunaReserve}
              disabled={readOnly}
              id={id}
              onCheckedChange={value => write(settings.set('codexLunaReserve', value))}
            />
          )}
        </Row>
      </Group>

      <FailureRecoveryGroup readOnly={readOnly} write={write} />

      <Group description="Where current quota is shown." title="Usage surfaces">
        <Row hint="Meters above the sidebar foot (one button on the collapsed rail); click one for the account cards." label="Sidebar usage">
          {id => (
            <Switch checked={preferences.footerButton} disabled={readOnly} id={id} onCheckedChange={value => write(settings.set('footerButton', value))} />
          )}
        </Row>
        <Row hint="Controls the governing window and collapsed rail; all-window layouts show percentages." label="Meter shows">
          {id => (
            <Select
              disabled={readOnly || !preferences.footerButton}
              onValueChange={value => {
                const meterLabel = METER_LABELS.find(candidate => candidate.value === value)?.value
                if (meterLabel !== undefined) write(settings.set('meterLabel', meterLabel))
              }}
              value={preferences.meterLabel}
            >
              <SelectTrigger className="dshx:w-44" id={id} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METER_LABELS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Row>
        <Row
          hint="Choose which quota windows appear for each account in the wide sidebar strip. The collapsed rail still shows the most critical window."
          label="Windows per account"
        >
          {id => (
            <Select
              disabled={readOnly || !preferences.footerButton}
              onValueChange={value => {
                const layout = USAGE_WINDOW_LAYOUTS.find(candidate => candidate.value === value)?.value
                if (layout !== undefined) write(settings.set('usageWindowLayout', layout))
              }}
              value={preferences.usageWindowLayout}
            >
              <SelectTrigger className="dshx:w-52" id={id} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USAGE_WINDOW_LAYOUTS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Row>
        {file === null ? null : (
          <UsageAccountsPicker
            accounts={file.accounts.filter(account => account.enabled)}
            disabled={readOnly}
            hidden={preferences.hiddenUsageAccounts}
            onChange={ids => write(settings.set('hiddenUsageAccounts', ids))}
          />
        )}
        <Row hint="Draggable tab pinned to a window edge." label="Edge overlay">
          {id => <Switch checked={preferences.edgeWidget} disabled={readOnly} id={id} onCheckedChange={value => write(settings.set('edgeWidget', value))} />}
        </Row>
        <Row hint="Lists and edits these accounts at the bottom of Settings › Models." label="Accounts on the Models page">
          {id => (
            <Switch
              checked={preferences.modelsPageAccounts}
              disabled={readOnly}
              id={id}
              onCheckedChange={value => write(settings.set('modelsPageAccounts', value))}
            />
          )}
        </Row>
        <Row hint="How often open surfaces ask for fresh quota. Surfaces share one Host reading." label="Refresh usage every">
          {id => (
            <NumberSelect
              disabled={readOnly}
              format={value => (value < 60 ? `${String(value)} s` : `${String(value / 60)} min`)}
              id={id}
              onChange={value => write(settings.set('usageRefreshSeconds', value))}
              options={REFRESH_SECONDS}
              value={preferences.usageRefreshMs / 1000}
            />
          )}
        </Row>
      </Group>

      <CostEstimatesGroup readOnly={readOnly} write={write} />

      <Group description="The Host records one quota snapshot per enabled account on this schedule." title="Usage history">
        <Row label="Record every">
          {id => (
            <NumberSelect
              disabled={history === null}
              format={value => `${String(value)} min`}
              id={id}
              onChange={intervalMinutes => saveHistory({ intervalMinutes })}
              options={INTERVAL_MINUTES}
              value={history?.intervalMinutes ?? 5}
            />
          )}
        </Row>
        <Row label="Keep history for">
          {id => (
            <NumberSelect
              disabled={history === null}
              format={value => `${String(value)} days`}
              id={id}
              onChange={retentionDays => saveHistory({ retentionDays })}
              options={RETENTION_DAYS}
              value={history?.retentionDays ?? 90}
            />
          )}
        </Row>
      </Group>
    </div>
  )
}

/** Which accounts the usage strip and popover show; a new account shows until it is hidden. */
const UsageAccountsPicker = (props: {
  readonly accounts: readonly AccountsFile['accounts'][number][]
  readonly hidden: readonly string[]
  readonly disabled: boolean
  readonly onChange: (ids: string[]) => void
}): JSX.Element | null => {
  if (props.accounts.length === 0) return null
  const hidden = new Set(props.hidden)
  const toggle = (id: string, shown: boolean): void =>
    props.onChange(shown ? props.hidden.filter(candidate => candidate !== id) : [...props.hidden.filter(candidate => candidate !== id), id])
  return (
    <fieldset className="dshx:flex dshx:flex-col dshx:gap-1.5">
      <legend className="dshx:text-sm">Accounts in the usage strip and popover</legend>
      <p className="dshx:text-xs dshx:text-muted-foreground">Right-click an account there to hide it or move it; drag to reorder.</p>
      <div className="dshx:mt-1 dshx:flex dshx:flex-wrap dshx:gap-x-4 dshx:gap-y-1.5">
        {props.accounts.map(account => (
          <Label className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-sm dshx:font-normal" key={account.instanceId}>
            <Checkbox
              checked={!hidden.has(account.instanceId)}
              disabled={props.disabled}
              onCheckedChange={value => toggle(account.instanceId, value === true)}
            />
            {account.displayName}
          </Label>
        ))}
      </div>
    </fieldset>
  )
}

const CostEstimatesGroup = (props: { readonly readOnly: boolean; readonly write: (task: Promise<unknown>) => void }): JSX.Element => {
  const accounts = useApi(aiAccountsApi)
  const queryClient = useQueryClient()
  const preferences = usePreferences()
  const settings = preferences.settings
  const status = useQuery(aiAccountsQueries.pricingStatus(accounts))
  const refresh = useMutation({
    mutationFn: () => accounts.refreshPricing(),
    onSuccess: next => {
      queryClient.setQueryData(aiAccountsKeys.pricingStatus, next)
      void queryClient.invalidateQueries({ queryKey: aiAccountsKeys.pricing })
    },
  })
  const savedText = overridesToText(preferences.pricingOverrides)
  const [draft, setDraft] = useState<string | null>(null)
  const parsed = textToOverrides(draft ?? savedText)
  const pricing = status.data ?? null

  const saveOverrides = (): void => {
    if (draft === null || draft === savedText) return
    props.write(
      settings.set('pricingOverrides', parsed.overrides).then(() => {
        setDraft(null)
        void queryClient.invalidateQueries({ queryKey: aiAccountsKeys.pricing })
      }),
    )
  }

  return (
    <Group description="Estimated cost per session beside the composer stats, priced from models.dev. An estimate, never an invoice." title="Cost estimates">
      <Row hint="Shows ≈$ beside the token stats; hover it for the breakdown." label="Show session cost">
        {id => (
          <Switch
            checked={preferences.costEstimates}
            disabled={props.readOnly}
            id={id}
            onCheckedChange={value => props.write(settings.set('costEstimates', value))}
          />
        )}
      </Row>
      <Row hint="Choose whether the estimate joins the token-usage stats or stays in its own dock entry." label="Cost placement">
        {id => (
          <Select
            disabled={props.readOnly || !preferences.costEstimates}
            onValueChange={value => props.write(settings.set('costPlacement', value === 'separate' ? 'separate' : 'inside'))}
            value={preferences.costPlacement}
          >
            <SelectTrigger className="dshx:w-36" id={id} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inside">Inside stats</SelectItem>
              <SelectItem value="separate">Separate</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Row>
      <Row label="Refresh prices every">
        {id => (
          <NumberSelect
            disabled={props.readOnly}
            format={value => (value < 48 ? `${String(value)} h` : `${String(value / 24)} days`)}
            id={id}
            onChange={value => props.write(settings.set('pricingRefreshHours', value))}
            options={PRICING_REFRESH_HOURS}
            value={preferences.pricingRefreshHours}
          />
        )}
      </Row>
      <Row
        hint={pricingStatusLine({ pricing, fetchedAge: pricing === null || pricing.fetchedAt === null ? null : relativeTime(pricing.fetchedAt, Date.now()) })}
        label="Price catalog"
      >
        {() => (
          <Button disabled={pricing === null || refresh.isPending} onClick={() => refresh.mutate()} size="sm" type="button" variant="outline">
            <RefreshCwIcon className={refresh.isPending ? 'dshx:animate-spin' : undefined} />
            Refresh now
          </Button>
        )}
      </Row>
      <div className="dshx:flex dshx:flex-col dshx:gap-1.5">
        <Label className="dshx:text-sm dshx:font-normal" htmlFor="ai-accounts-pricing-overrides">
          Price overrides
        </Label>
        <p className="dshx:text-xs dshx:text-muted-foreground">
          One rule per line: <code>route/model = value</code>, or <code>route/*</code> for every model of a route. The value is a models.dev id (
          <code>openai/gpt-6-luna</code>), <code>free</code>, or USD per million tokens (<code>input=3 output=15 cacheRead=0.3 cacheWrite=3.75</code>).
        </p>
        <Textarea
          className="dshx:min-h-20 dshx:font-mono! dshx:text-xs"
          disabled={props.readOnly}
          id="ai-accounts-pricing-overrides"
          onBlur={saveOverrides}
          onChange={event => setDraft(event.target.value)}
          placeholder="commandcode_work/* = openai/gpt-6-luna"
          spellCheck={false}
          value={draft ?? savedText}
        />
        {parsed.skipped === 0 ? null : (
          <p className="dshx:text-xs dshx:text-destructive">
            {String(parsed.skipped)} line{parsed.skipped === 1 ? '' : 's'} not in <code>route/model = value</code> form will be dropped.
          </p>
        )}
      </div>
    </Group>
  )
}

/**
 * What a failed request on an account route does next, per failure kind. The
 * options run top to bottom, each skipped when off or unavailable.
 */
const FailureRecoveryGroup = (props: { readonly readOnly: boolean; readonly write: (task: Promise<unknown>) => void }): JSX.Element => {
  const preferences = usePreferences()
  const policy = preferences.failureRecovery
  const update = <Field extends keyof KindPolicy>(kind: FailureKind, field: Field, value: KindPolicy[Field]): void =>
    props.write(preferences.settings.set('failureRecovery', { ...policy, [kind]: { ...policy[kind], [field]: value } }))

  return (
    <Group
      description="Options run top to bottom: same account, Luna Reserve, next account of the same provider with the same model (in usage-strip order, hidden accounts skipped), wait, a smaller request. A switch shows as a retry row in the turn."
      title="Failure recovery"
    >
      {FAILURE_KINDS.map(kind => {
        const copy = FAILURE_KIND_COPY[kind]
        const current = policy[kind]
        const shows = (field: keyof KindPolicy): boolean => copy.options.includes(field)
        return (
          <fieldset className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-t dshx:pt-3 dshx:first-of-type:border-t-0 dshx:first-of-type:pt-0" key={kind}>
            <legend className="dshx:flex dshx:flex-col dshx:gap-0.5">
              <span className="dshx:text-sm dshx:font-medium">{copy.title}</span>
              <span className="dshx:text-xs dshx:text-muted-foreground">{copy.hint}</span>
            </legend>
            {shows('retries') ? (
              <Row label="Retry the same account">
                {id => (
                  <NumberSelect
                    disabled={props.readOnly}
                    format={value => (value === 0 ? 'Never' : `${String(value)}×`)}
                    id={id}
                    onChange={value => update(kind, 'retries', value)}
                    options={RETRY_COUNTS}
                    value={current.retries}
                  />
                )}
              </Row>
            ) : null}
            {shows('backoffMs') && current.retries > 0 ? (
              <Row hint="Each further retry waits twice as long." label="First retry after">
                {id => (
                  <NumberSelect
                    disabled={props.readOnly}
                    format={formatDuration}
                    id={id}
                    onChange={value => update(kind, 'backoffMs', value)}
                    options={BACKOFF_MS}
                    value={current.backoffMs}
                  />
                )}
              </Row>
            ) : null}
            {shows('lunaReserve') ? (
              <Row hint="Codex accounts with reserve left, while Codex Luna Reserve is on." label="Continue on Luna Reserve">
                {id => (
                  <Switch
                    checked={current.lunaReserve}
                    disabled={props.readOnly || !preferences.codexLunaReserve}
                    id={id}
                    onCheckedChange={value => update(kind, 'lunaReserve', value)}
                  />
                )}
              </Row>
            ) : null}
            {shows('failover') ? (
              <Row hint="The failed account cools down; the conversation returns to it once it recovers." label="Fail over to the next account">
                {id => <Switch checked={current.failover} disabled={props.readOnly} id={id} onCheckedChange={value => update(kind, 'failover', value)} />}
              </Row>
            ) : null}
            {shows('waitSeconds') ? (
              <Row hint="Waits out a provider-declared reset no longer than this, then retries once." label="Then wait up to">
                {id => (
                  <NumberSelect
                    disabled={props.readOnly}
                    format={value => (value === 0 ? 'Never' : formatDuration(value * 1_000))}
                    id={id}
                    onChange={value => update(kind, 'waitSeconds', value)}
                    options={WAIT_SECONDS}
                    value={current.waitSeconds}
                  />
                )}
              </Row>
            ) : null}
            {shows('shrink') ? (
              <Row hint="Last try: images the model already answered go as file placeholders. Large tool outputs are kept." label="Shrink before the last try">
                {id => <Switch checked={current.shrink} disabled={props.readOnly} id={id} onCheckedChange={value => update(kind, 'shrink', value)} />}
              </Row>
            ) : null}
            <Row label="When nothing is left">
              {id => (
                <Select disabled={props.readOnly} onValueChange={value => update(kind, 'then', value === 'dsh' ? 'dsh' : 'fail')} value={current.then}>
                  <SelectTrigger className="dshx:w-44" id={id} size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fail">Fail the turn</SelectItem>
                    <SelectItem value="dsh">Hand to DSH</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </Row>
          </fieldset>
        )
      })}
    </Group>
  )
}
