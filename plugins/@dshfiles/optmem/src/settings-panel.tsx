import { useApi, useSettings } from '@dshfiles/dshx/client'
import { Alert, AlertDescription } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'

import { optmemApi, type OptmemOverview, type OptmemProvider } from './api.ts'
import { OptmemSettingsDraft, type RouteWarning, type SettingsEdits, type SettingsKey } from './settings-draft.ts'
import { optmemSettings, type OptmemSettings } from './settings.ts'

type Effort = OptmemSettings['summarizerEffort']

const efforts: readonly { readonly value: Effort; readonly label: string }[] = [
  { value: '', label: 'Default effort' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

const selectClass =
  'dshx:h-8 dshx:max-w-56 dshx:min-w-0 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-sm dshx:text-foreground dshx:disabled:opacity-50'

const schemaHint = (key: SettingsKey): string => {
  const description: unknown = optmemSettings.schema.dict?.[key]?.meta?.description
  return typeof description === 'string' ? description : ''
}

const formatBytes = (bytes: number | null): string => {
  if (bytes === null) return 'n/a'
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`
  return `${(bytes / 1_048_576).toFixed(1)} MiB`
}

const Section = (props: { readonly title: string; readonly description?: string; readonly children: ReactNode }): JSX.Element => (
  <section className="dshx:flex dshx:flex-col dshx:gap-1 dshx:rounded-lg dshx:border dshx:border-border dshx:p-4">
    <h3 className="dshx:text-sm dshx:font-semibold">{props.title}</h3>
    {props.description ? <p className="dshx:text-xs dshx:text-muted-foreground">{props.description}</p> : null}
    <div className="dshx:mt-2 dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border">{props.children}</div>
  </section>
)

const Row = (props: { readonly label: string; readonly hint?: string; readonly htmlFor?: string; readonly children: ReactNode }): JSX.Element => (
  <div className="dshx:flex dshx:flex-wrap dshx:items-start dshx:justify-between dshx:gap-x-4 dshx:gap-y-2 dshx:py-3">
    <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:basis-64 dshx:flex-col dshx:gap-0.5">
      <label htmlFor={props.htmlFor} className="dshx:text-sm dshx:font-medium">
        {props.label}
      </label>
      {props.hint ? <p className="dshx:text-xs dshx:text-muted-foreground">{props.hint}</p> : null}
    </div>
    <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2">{props.children}</div>
  </div>
)

const Warnings = (props: { readonly warnings: readonly RouteWarning[] }): JSX.Element | null =>
  props.warnings.length === 0 ? null : (
    <ul className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:text-xs dshx:text-warning">
      {props.warnings.map(warning => (
        <li key={warning.message}>{warning.message}</li>
      ))}
    </ul>
  )

const NumberField = (props: {
  readonly id: string
  readonly value: number
  readonly disabled: boolean
  readonly onChange: (value: number) => void
}): JSX.Element => {
  const [text, setText] = useState(String(props.value))
  useEffect(() => setText(String(props.value)), [props.value])
  return (
    <Input
      id={props.id}
      type="number"
      inputMode="numeric"
      className="dshx:w-32 dshx:font-mono!"
      value={text}
      disabled={props.disabled}
      onChange={event => {
        setText(event.target.value)
        const parsed = Number(event.target.value)
        if (event.target.value.trim() !== '' && Number.isFinite(parsed)) props.onChange(parsed)
      }}
    />
  )
}

const EffortSelect = (props: {
  readonly value: Effort
  readonly disabled: boolean
  readonly label: string
  readonly onChange: (value: Effort) => void
}): JSX.Element => (
  <select
    aria-label={props.label}
    className={selectClass}
    value={props.value}
    disabled={props.disabled}
    onChange={event => props.onChange(efforts.find(effort => effort.value === event.target.value)?.value ?? '')}
  >
    {efforts.map(effort => (
      <option key={effort.value} value={effort.value}>
        {effort.label}
      </option>
    ))}
  </select>
)

const ListControls = (props: {
  readonly index: number
  readonly length: number
  readonly disabled: boolean
  readonly label: string
  readonly onMove: (to: number) => void
  readonly onRemove: () => void
}): JSX.Element => (
  <div className="dshx:flex dshx:shrink-0 dshx:items-center">
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Move ${props.label} up`}
      disabled={props.disabled || props.index === 0}
      onClick={() => props.onMove(props.index - 1)}
    >
      <ArrowUpIcon />
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Move ${props.label} down`}
      disabled={props.disabled || props.index === props.length - 1}
      onClick={() => props.onMove(props.index + 1)}
    >
      <ArrowDownIcon />
    </Button>
    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${props.label}`} disabled={props.disabled} onClick={props.onRemove}>
      <Trash2Icon />
    </Button>
  </div>
)

/** An ordered list of strings with add, reorder and remove; used for cheap models and exclusions. */
const StringList = (props: {
  readonly values: readonly string[]
  readonly disabled: boolean
  readonly placeholder: string
  readonly itemLabel: string
  readonly suggestions?: string | undefined
  readonly onChange: (values: readonly string[]) => void
}): JSX.Element => (
  <div className="dshx:flex dshx:w-full dshx:flex-col dshx:gap-1.5">
    {props.values.map((value, index) => (
      <div key={index} className="dshx:flex dshx:items-center dshx:gap-1">
        <Input
          className="dshx:h-8 dshx:font-mono! dshx:text-xs"
          aria-label={`${props.itemLabel} ${index + 1}`}
          value={value}
          list={props.suggestions}
          placeholder={props.placeholder}
          disabled={props.disabled}
          onChange={event => props.onChange(props.values.map((item, at) => (at === index ? event.target.value : item)))}
        />
        <ListControls
          index={index}
          length={props.values.length}
          disabled={props.disabled}
          label={value || props.itemLabel}
          onMove={to => props.onChange(OptmemSettingsDraft.move(props.values, index, to))}
          onRemove={() => props.onChange(props.values.filter((_, at) => at !== index))}
        />
      </div>
    ))}
    <Button variant="outline" size="xs" className="dshx:self-start" disabled={props.disabled} onClick={() => props.onChange([...props.values, ''])}>
      <PlusIcon /> Add {props.itemLabel}
    </Button>
  </div>
)

const ProviderSelect = (props: {
  readonly value: string
  readonly providers: readonly OptmemProvider[]
  readonly disabled: boolean
  readonly label: string
  readonly onChange: (value: string) => void
}): JSX.Element => {
  const known = props.value === '' || props.providers.some(provider => provider.id === props.value)
  return (
    <select
      aria-label={props.label}
      className={selectClass}
      value={props.value}
      disabled={props.disabled}
      onChange={event => props.onChange(event.target.value)}
    >
      <option value="">Thread's provider</option>
      {props.providers.map(provider => (
        <option key={provider.id} value={provider.id}>
          {provider.name === provider.id ? provider.id : `${provider.name} (${provider.id})`}
        </option>
      ))}
      {known ? null : <option value={props.value}>{props.value} (not configured)</option>}
    </select>
  )
}

const modelOptions = (providers: readonly OptmemProvider[], provider: string): readonly string[] =>
  [...new Set((provider === '' ? providers : providers.filter(candidate => candidate.id === provider)).flatMap(candidate => candidate.models))].toSorted()

const ModelDatalist = (props: { readonly id: string; readonly models: readonly string[] }): JSX.Element => (
  <datalist id={props.id}>
    {props.models.map(model => (
      <option key={model} value={model} />
    ))}
  </datalist>
)

const StatusBlock = (props: {
  readonly overview: OptmemOverview | undefined
  readonly error: string | undefined
  readonly refreshing: boolean
  readonly onRefresh: () => void
}): JSX.Element => {
  if (props.error !== undefined)
    return (
      <Alert>
        <AlertDescription>
          Live status is unavailable ({props.error}). A DSH restart loads the OptMem host that serves it; settings below still save.
        </AlertDescription>
      </Alert>
    )
  const overview = props.overview
  if (!overview) return <p className="dshx:text-xs dshx:text-muted-foreground">Loading status…</p>
  const route = overview.lastRoute
  const pipeline = overview.pipeline
  const facts: readonly [string, string][] = [
    ['Database', `${formatBytes(overview.database.bytes)} · ${overview.database.path}`],
    ['Stored events', overview.uniqueEvents === null || overview.uniqueEvents === undefined ? 'n/a' : String(overview.uniqueEvents)],
    ['Stream entries', overview.events === null ? 'n/a' : `${overview.events} across ${overview.streams ?? 0} streams`],
    ['Captured this run', `${overview.captured} (skipped ${overview.skipped}, queued ${overview.queued})`],
    ['Summary calls this run', overview.summaryCalls === null ? 'n/a' : String(overview.summaryCalls)],
    ['Pipeline jobs in memory', overview.pendingSummaries === null ? 'n/a' : String(overview.pendingSummaries)],
    ['Pending leaf entries', pipeline === undefined ? 'n/a' : String(pipeline.pendingLeafJobs)],
    ['Distinct pending events', pipeline === undefined ? 'n/a' : String(pipeline.pendingEvents)],
    ['Estimated leaf model calls', pipeline === undefined ? 'n/a' : String(pipeline.estimatedLeafSummaryCalls)],
    ['Pending merge summaries', pipeline === undefined ? 'n/a' : String(pipeline.pendingMergeJobs)],
    [
      'Oldest pending event',
      pipeline?.oldestPendingAt === null || pipeline?.oldestPendingAt === undefined ? 'none' : new Date(pipeline.oldestPendingAt).toLocaleString(),
    ],
    ['Completed summary nodes', pipeline === undefined ? 'n/a' : String(pipeline.completedSummaryNodes)],
    ['Summary nodes / minute (10m)', pipeline === undefined ? 'n/a' : String((pipeline.summariesLastTenMinutes / 10).toFixed(1))],
    [
      'Last summary route',
      route.kind === 'ready'
        ? `${route.route.provider}/${route.route.model} (${route.route.effort ?? 'default'} effort, ${route.source})`
        : route.kind === 'unavailable'
          ? `none: ${route.reason}`
          : 'no summary requested yet',
    ],
    ['Current error', overview.lastError ?? overview.failure ?? 'none'],
  ]
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2">
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <Badge variant={pipeline?.health === 'degraded' || overview.state === 'failed' ? 'destructive' : 'secondary'}>
          {overview.state === 'ready' ? `Capture ready · ${pipeline?.health ?? 'pipeline status unavailable'}` : overview.state}
        </Badge>
        <Badge variant="outline">{overview.activeMode === 'full' ? 'Full mode' : 'Compatibility mode'}</Badge>
        {overview.retryInMs === null ? null : <Badge variant="outline">retry in {Math.ceil(overview.retryInMs / 1_000)} s</Badge>}
        {overview.settingsSource === 'defaults' ? <Badge variant="outline">running on defaults</Badge> : null}
        <Button variant="ghost" size="icon-sm" className="dshx:ml-auto" aria-label="Refresh status" disabled={props.refreshing} onClick={props.onRefresh}>
          <RefreshCwIcon />
        </Button>
      </div>
      <p className="dshx:text-xs dshx:text-muted-foreground">
        Pending leaf entries are per-stream positions; one event may appear in both its conversation and project tree. Estimated model calls count only distinct
        oversized events without an existing summary node.
      </p>
      <dl className="dshx:grid dshx:grid-cols-[max-content_1fr] dshx:gap-x-4 dshx:gap-y-1 dshx:text-xs">
        {facts.map(([term, value]) => (
          <div key={term} className="dshx:contents">
            <dt className="dshx:text-muted-foreground">{term}</dt>
            <dd className="dshx:min-w-0 dshx:break-all dshx:font-mono">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export const OptmemSettingsPanel = (): JSX.Element => {
  const settings = useSettings(optmemSettings)
  const api = useApi(optmemApi)
  const fieldId = useId()
  const [edits, setEdits] = useState<SettingsEdits>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)

  const overviewQuery = useQuery({
    queryKey: ['optmem', 'overview'],
    queryFn: ({ signal }) => api.overview(undefined, { signal }),
    refetchInterval: 5_000,
    retry: false,
  })
  const providersQuery = useQuery({
    queryKey: ['optmem', 'providers'],
    queryFn: ({ signal }) => api.providers(undefined, { signal }),
    staleTime: 60_000,
    retry: false,
  })
  const backfill = useMutation({ mutationFn: () => api.backfill({ limit: 20 }), onSuccess: () => void overviewQuery.refetch() })

  const base = useMemo(() => OptmemSettingsDraft.decode(settings.value), [settings.value])
  const draft = OptmemSettingsDraft.merge(base, edits)
  const changed = OptmemSettingsDraft.changedKeys(base, edits)
  const invalid = OptmemSettingsDraft.validationError(draft)
  const providers = providersQuery.data ?? []
  const warnings = OptmemSettingsDraft.routeWarnings(draft, providers)
  const warningsFor = (field: string): readonly RouteWarning[] => warnings.filter(warning => warning.field === field)
  const disabled = !settings.writable || saving
  const fullModeAvailable = overviewQuery.data?.fullModeAvailable === true

  const edit = <K extends SettingsKey>(key: K, value: OptmemSettings[K]): void => setEdits(current => ({ ...current, [key]: value }))

  const save = async (): Promise<void> => {
    setSaving(true)
    setSaveError(undefined)
    try {
      for (const key of changed) await settings.set(key, draft[key])
      setEdits({})
    } catch (error) {
      setSaveError(errorMessage(error, 'The Host did not accept these settings.'))
    } finally {
      setSaving(false)
    }
  }

  const togglePause = async (): Promise<void> => {
    setSaveError(undefined)
    try {
      await settings.set('summarizerPaused', !base.summarizerPaused)
      setEdits(({ summarizerPaused: _dropped, ...rest }) => rest)
      void overviewQuery.refetch()
    } catch (error) {
      setSaveError(errorMessage(error, 'The Host did not accept the change.'))
    }
  }

  const id = (key: string): string => `${fieldId}-${key}`
  const numberRow = (key: SettingsKey & { [K in SettingsKey]: OptmemSettings[K] extends number ? K : never }[SettingsKey], label: string): JSX.Element => (
    <Row label={label} hint={schemaHint(key)} htmlFor={id(key)}>
      <NumberField id={id(key)} value={draft[key]} disabled={disabled} onChange={value => edit(key, value)} />
    </Row>
  )
  const switchRow = (key: SettingsKey & { [K in SettingsKey]: OptmemSettings[K] extends boolean ? K : never }[SettingsKey], label: string): JSX.Element => (
    <Row label={label} hint={schemaHint(key)} htmlFor={id(key)}>
      <Switch id={id(key)} checked={draft[key]} disabled={disabled} onCheckedChange={checked => edit(key, checked)} />
    </Row>
  )

  const allModelsId = id('all-models')
  const overrideModelsId = id('override-models')
  const overrideActive = draft.summarizerModel !== ''

  return (
    <div className="dshx-root dshx:flex dshx:flex-col dshx:gap-4 dshx:pb-4">
      <header className="dshx:flex dshx:flex-col dshx:gap-1">
        <h2 className="dshx:text-base dshx:font-semibold">Memory (OptMem)</h2>
        <p className="dshx:text-xs dshx:text-muted-foreground">
          Captures sessions into a per-project memory, adds memory tools and injects a compact memory view. Changes apply live.
        </p>
      </header>

      {settings.error ? (
        <Alert>
          <AlertDescription>
            {settings.error.kind === 'namespace-unregistered'
              ? 'The running DSH host does not serve OptMem settings yet. Restart DSH to load them; defaults are shown.'
              : `Settings are unavailable (${settings.error.kind}); defaults are shown.`}
          </AlertDescription>
        </Alert>
      ) : null}

      <Section title="Status">
        <div className="dshx:py-3">
          <StatusBlock
            overview={overviewQuery.data}
            error={overviewQuery.error ? errorMessage(overviewQuery.error, 'unknown error') : undefined}
            refreshing={overviewQuery.isFetching}
            onRefresh={() => void overviewQuery.refetch()}
          />
        </div>
        <Row label="Pause summarizing" hint="Takes effect immediately. Pending summaries wait and are retried once resumed.">
          <Button variant="outline" size="sm" disabled={!settings.writable} onClick={() => void togglePause()}>
            {base.summarizerPaused ? 'Resume summaries' : 'Pause summaries'}
          </Button>
        </Row>
        <Row label="Backfill" hint="Import up to 20 existing DSH sessions not yet in memory (resumable; run again to continue).">
          <Button variant="outline" size="sm" disabled={backfill.isPending || overviewQuery.data?.state !== 'ready'} onClick={() => backfill.mutate()}>
            {backfill.isPending ? 'Backfilling…' : 'Backfill sessions'}
          </Button>
        </Row>
        {backfill.data ? <p className="dshx:py-2 dshx:text-xs">{backfill.data.text}</p> : null}
        {backfill.error ? <p className="dshx:py-2 dshx:text-xs dshx:text-destructive">{errorMessage(backfill.error, 'Backfill failed.')}</p> : null}
      </Section>

      <Section title="General">
        {switchRow('enabled', 'Enable OptMem')}
        <Row label="Mode" hint={schemaHint('mode')}>
          <select
            aria-label="Mode"
            className={selectClass}
            value={draft.mode}
            disabled={disabled || (!fullModeAvailable && draft.mode !== 'full')}
            onChange={event => edit('mode', event.target.value === 'full' ? 'full' : 'compat')}
          >
            <option value="compat">Compatibility</option>
            <option value="full" disabled={!fullModeAvailable}>
              Full{fullModeAvailable ? '' : ' (needs the fork core)'}
            </option>
          </select>
        </Row>
        {switchRow('captureSubagents', 'Capture subagents')}
        {switchRow('allowAllProjects', 'Cross-project memory tools')}
      </Section>

      <Section
        title="Summaries"
        description="By default each summary uses the thread's own provider with that provider kind's cheap model. The thread's own model is never used: when no route fits, the summary waits and is retried."
      >
        <ModelDatalist id={allModelsId} models={modelOptions(providers, '')} />
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:py-3">
          <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-4">
            <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
              <span className="dshx:text-sm dshx:font-medium">Override route</span>
              <p className="dshx:text-xs dshx:text-muted-foreground">
                One fixed provider, model and effort for every summary, instead of the per-kind cheap model.
              </p>
            </div>
            <Switch
              aria-label="Use an override route"
              checked={overrideActive}
              disabled={disabled}
              onCheckedChange={checked => {
                edit('summarizerModel', checked ? base.summarizerModel || OptmemSettingsDraft.defaults.cheapModels[0]?.models[0] || 'model' : '')
                if (!checked) edit('summarizerProvider', '')
              }}
            />
          </div>
          {overrideActive ? (
            <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
              <ModelDatalist id={overrideModelsId} models={modelOptions(providers, draft.summarizerProvider)} />
              <ProviderSelect
                label="Override provider"
                value={draft.summarizerProvider}
                providers={providers}
                disabled={disabled}
                onChange={value => edit('summarizerProvider', value)}
              />
              <Input
                aria-label="Override model"
                className="dshx:h-8 dshx:w-56 dshx:font-mono! dshx:text-xs"
                list={overrideModelsId}
                value={draft.summarizerModel}
                disabled={disabled}
                onChange={event => edit('summarizerModel', event.target.value)}
              />
              <EffortSelect label="Override effort" value={draft.summarizerEffort} disabled={disabled} onChange={value => edit('summarizerEffort', value)} />
            </div>
          ) : null}
          <Warnings warnings={warningsFor('override')} />
        </div>

        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:py-3">
          <span className="dshx:text-sm dshx:font-medium">Cheap model per provider kind</span>
          <p className="dshx:text-xs dshx:text-muted-foreground">{schemaHint('cheapModels')}</p>
          {draft.cheapModels.map((entry, index) => {
            const update = (next: Partial<OptmemSettings['cheapModels'][number]>): void =>
              edit(
                'cheapModels',
                draft.cheapModels.map((item, at) => (at === index ? { ...item, ...next } : item)),
              )
            return (
              <div key={index} className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:p-3">
                <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                  <Input
                    aria-label={`Provider kind ${index + 1}`}
                    className="dshx:h-8 dshx:w-44 dshx:font-mono! dshx:text-xs"
                    placeholder="codex, claude or provider id"
                    value={entry.kind}
                    disabled={disabled}
                    onChange={event => update({ kind: event.target.value })}
                  />
                  <EffortSelect
                    label={`Effort for ${entry.kind || 'entry'}`}
                    value={entry.effort}
                    disabled={disabled}
                    onChange={value => update({ effort: value })}
                  />
                  <div className="dshx:ml-auto">
                    <ListControls
                      index={index}
                      length={draft.cheapModels.length}
                      disabled={disabled}
                      label={entry.kind || 'entry'}
                      onMove={to => edit('cheapModels', OptmemSettingsDraft.move(draft.cheapModels, index, to))}
                      onRemove={() =>
                        edit(
                          'cheapModels',
                          draft.cheapModels.filter((_, at) => at !== index),
                        )
                      }
                    />
                  </div>
                </div>
                <StringList
                  values={entry.models}
                  disabled={disabled}
                  placeholder="model id, or prefix* for the newest"
                  itemLabel="model"
                  suggestions={allModelsId}
                  onChange={models => update({ models: [...models] })}
                />
                <Warnings warnings={warningsFor(`cheapModels.${index}`)} />
              </div>
            )
          })}
          <div className="dshx:flex dshx:gap-2">
            <Button
              variant="outline"
              size="xs"
              disabled={disabled}
              onClick={() => edit('cheapModels', [...draft.cheapModels, { kind: '', models: [], effort: '' }])}
            >
              <PlusIcon /> Add provider kind
            </Button>
            <Button variant="ghost" size="xs" disabled={disabled} onClick={() => edit('cheapModels', OptmemSettingsDraft.defaults.cheapModels)}>
              Restore defaults
            </Button>
          </div>
        </div>

        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:py-3">
          <span className="dshx:text-sm dshx:font-medium">Fallback routes</span>
          <p className="dshx:text-xs dshx:text-muted-foreground">{schemaHint('summarizerFallbacks')}</p>
          {draft.summarizerFallbacks.map((entry, index) => {
            const update = (next: Partial<OptmemSettings['summarizerFallbacks'][number]>): void =>
              edit(
                'summarizerFallbacks',
                draft.summarizerFallbacks.map((item, at) => (at === index ? { ...item, ...next } : item)),
              )
            const listId = id(`fallback-models-${index}`)
            return (
              <div key={index} className="dshx:flex dshx:flex-col dshx:gap-1">
                <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
                  <span className="dshx:w-5 dshx:text-xs dshx:text-muted-foreground">{index + 1}.</span>
                  <ModelDatalist id={listId} models={modelOptions(providers, entry.provider)} />
                  <ProviderSelect
                    label={`Fallback ${index + 1} provider`}
                    value={entry.provider}
                    providers={providers}
                    disabled={disabled}
                    onChange={value => update({ provider: value })}
                  />
                  <Input
                    aria-label={`Fallback ${index + 1} model`}
                    className="dshx:h-8 dshx:w-56 dshx:font-mono! dshx:text-xs"
                    list={listId}
                    value={entry.model}
                    disabled={disabled}
                    onChange={event => update({ model: event.target.value })}
                  />
                  <EffortSelect label={`Fallback ${index + 1} effort`} value={entry.effort} disabled={disabled} onChange={value => update({ effort: value })} />
                  <ListControls
                    index={index}
                    length={draft.summarizerFallbacks.length}
                    disabled={disabled}
                    label={`fallback ${index + 1}`}
                    onMove={to => edit('summarizerFallbacks', OptmemSettingsDraft.move(draft.summarizerFallbacks, index, to))}
                    onRemove={() =>
                      edit(
                        'summarizerFallbacks',
                        draft.summarizerFallbacks.filter((_, at) => at !== index),
                      )
                    }
                  />
                </div>
                <Warnings warnings={warningsFor(`summarizerFallbacks.${index}`)} />
              </div>
            )
          })}
          <Button
            variant="outline"
            size="xs"
            className="dshx:self-start"
            disabled={disabled}
            onClick={() => edit('summarizerFallbacks', [...draft.summarizerFallbacks, { provider: '', model: '', effort: '' }])}
          >
            <PlusIcon /> Add fallback
          </Button>
        </div>
        {numberRow('summarizerConcurrency', 'Concurrent summaries')}
        {numberRow('summarizerTimeoutMs', 'Summary timeout (ms)')}
        {numberRow('barrierMs', 'Pending-summary wait (ms)')}
        {providersQuery.error ? (
          <p className="dshx:py-2 dshx:text-xs dshx:text-muted-foreground">Model checks are off: the provider list is unavailable until DSH restarts.</p>
        ) : null}
      </Section>

      <Section title="Context and sizes" description="Byte budgets of the injected compact view, the main view and stored nodes.">
        {numberRow('injectUpperBytes', 'Injected view budget')}
        {numberRow('injectLowerBytes', 'Injected view merge target')}
        {numberRow('injectRefreshBytes', 'Re-inject after growth')}
        {numberRow('viewUpperBytes', 'Main view budget')}
        {numberRow('viewLowerBytes', 'Main view merge target')}
        {numberRow('maxNodeBytes', 'Memory node size')}
        {numberRow('toolResultCap', 'Tool result cap')}
      </Section>

      <Section title="Exclusions">
        <Row label="Excluded tools" hint={schemaHint('excludedTools')}>
          <span />
        </Row>
        <div className="dshx:pb-3">
          <StringList
            values={draft.excludedTools}
            disabled={disabled}
            placeholder="tool name"
            itemLabel="tool"
            onChange={values => edit('excludedTools', [...values])}
          />
        </div>
        <Row label="Excluded paths" hint={schemaHint('excludedPaths')}>
          <span />
        </Row>
        <div className="dshx:pb-3">
          <StringList
            values={draft.excludedPaths}
            disabled={disabled}
            placeholder="**/secret/**"
            itemLabel="path glob"
            onChange={values => edit('excludedPaths', [...values])}
          />
        </div>
      </Section>

      <footer className="dshx:sticky dshx:bottom-0 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-t dshx:border-border dshx:bg-background dshx:py-3">
        <span className="dshx:text-xs dshx:text-muted-foreground">
          {!settings.writable ? 'Read-only on this host.' : changed.length === 0 ? 'No unsaved changes.' : `${changed.length} unsaved change(s).`}
        </span>
        {invalid ? <span className="dshx:text-xs dshx:text-destructive">{invalid}</span> : null}
        {saveError ? <span className="dshx:text-xs dshx:text-destructive">{saveError}</span> : null}
        <div className="dshx:ml-auto dshx:flex dshx:gap-2">
          <Button variant="ghost" size="sm" disabled={saving || Object.keys(edits).length === 0} onClick={() => setEdits({})}>
            Discard
          </Button>
          <Button size="sm" disabled={disabled || changed.length === 0 || invalid !== undefined} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </footer>
    </div>
  )
}
