import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ModelDirectoryState, ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { useApi, useApiQuery, useSettings } from '@dshfiles/dshx/client'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { aiAccountsFastModeApi } from '@dshfiles/ai-accounts/model-fast-mode-api'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ScrollArea } from '@dshfiles/plugin-ui/components/ui/scroll-area'
import { Slider } from '@dshfiles/plugin-ui/components/ui/slider'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import {
  ArrowLeftIcon,
  ArrowLeftRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SearchIcon,
  SparklesIcon,
  ZapIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { FallbacksSection } from './fallbacks-section.js'
import { FastModeSection } from './fast-mode-section.js'
import { ModelPickerModel } from './model-picker-model.js'
import { modelEffortPickerSettings } from './settings.js'

type Props = ModelSelectInjected & { readonly locked: boolean; readonly sessionId: string }

type FastModeRoute = { readonly sessionId: string; readonly provider: string; readonly model: string }
type FastModeIndicatorProps = FastModeRoute & { readonly enabledOverride: boolean | undefined }
type CatalogGroup = ModelDirectoryState['groups'][number]
type CatalogModel = CatalogGroup['models'][number]

const fastModeRouteKey = ({ sessionId, provider, model }: FastModeRoute): string => JSON.stringify([sessionId, provider, model])

const FastModeIndicator = ({ sessionId, provider, model, enabledOverride }: FastModeIndicatorProps): JSX.Element => {
  const state = useApiQuery(aiAccountsFastModeApi, 'status', { input: { sessionId, provider, model } })
  if (enabledOverride ?? state.data?.enabled ?? false)
    return <ZapIcon aria-hidden="true" className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" data-model-fast-mode-enabled />
  return <SparklesIcon aria-hidden="true" className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
}

const ProviderMark = ({ provider, label }: { readonly provider: string; readonly label: string }): JSX.Element => {
  const key = `${provider} ${label}`.toLowerCase()
  const mark =
    key.includes('anthropic') || key.includes('claude')
      ? '✳'
      : key.includes('google') || key.includes('gemini')
        ? 'G'
        : key.includes('deepseek')
          ? '◉'
          : key.includes('openai') || key.includes('codex') || key.includes('gpt')
            ? '◎'
            : key.includes('meta') || key.includes('llama')
              ? '∞'
              : key.includes('qwen')
                ? '✦'
                : label.slice(0, 1).toUpperCase()
  return (
    <span
      aria-hidden="true"
      className="dshx:flex dshx:size-5 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-muted dshx:text-[13px] dshx:font-semibold dshx:text-foreground"
    >
      {mark}
    </span>
  )
}

const EffortBars = ({ count, active, compact = false }: { readonly count: number; readonly active: number; readonly compact?: boolean }): JSX.Element => (
  <span aria-hidden="true" className={cn('dshx:flex dshx:h-4 dshx:items-end dshx:gap-0.5', compact && 'dshx:gap-px')}>
    {Array.from({ length: Math.max(count, 3) }, (_, index) => (
      <i
        className={cn('dshx:block dshx:w-1 dshx:rounded-t-[1px]', index < active + 1 ? 'dshx:bg-primary' : 'dshx:bg-muted-foreground/35')}
        key={index}
        style={{ height: `${5 + index * (10 / Math.max(count, 3))}px` }}
      />
    ))}
  </span>
)

const InlineFastModeToggle = ({
  input,
  modelName,
  busy,
}: {
  readonly input: FastModeRoute
  readonly modelName: string
  readonly busy: boolean
}): JSX.Element | null => {
  const state = useApiQuery(aiAccountsFastModeApi, 'status', { input })
  const api = useApi(aiAccountsFastModeApi)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (state.data === undefined || !state.data.available) return null
  const enabled = state.data.enabled
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={`Fast mode ${enabled ? 'on' : 'off'} for ${modelName}`}
            aria-pressed={enabled}
            className={cn(
              'dshx:flex dshx:size-6 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:hover:bg-muted',
              enabled && 'dshx:text-amber-500',
            )}
            disabled={busy || pending}
            onClick={async event => {
              event.stopPropagation()
              setPending(true)
              setError(null)
              try {
                await api.setFast({ ...input, enabled: !enabled })
                await state.refetch()
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause))
              } finally {
                setPending(false)
              }
            }}
            type="button"
          >
            <ZapIcon className="dshx:size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{error ?? 'Fast mode'}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

type ModelRowProps = {
  readonly group: CatalogGroup
  readonly model: CatalogModel
  readonly active: boolean
  readonly busy: boolean
  readonly sessionId: string
  readonly quota: number | undefined
  readonly current: ModelSelection | null
  readonly onSelect: (selection: ModelSelection) => void
  readonly onDetails: () => void
  readonly onEffort: (selection: ModelSelection) => void
}

const ModelRow = (props: ModelRowProps): JSX.Element => {
  const [showFastMode, setShowFastMode] = useState(false)
  const input = { sessionId: props.sessionId, provider: props.group.id, model: props.model.id }
  const efforts = props.model.reasoning?.efforts ?? []
  const selectedEffort = props.active ? (props.current?.reasoningEffort ?? props.model.reasoning?.defaultEffort) : props.model.reasoning?.defaultEffort
  const effortIndex = Math.max(
    0,
    efforts.findIndex(effort => effort.id === selectedEffort),
  )

  return (
    <div
      className={cn(
        'dshx:group dshx:flex dshx:h-[34px] dshx:items-center dshx:gap-1 dshx:rounded-md dshx:px-1 dshx:transition-colors dshx:hover:bg-muted/70',
        props.active && 'dshx:bg-accent/70 dshx:ring-1 dshx:ring-primary/30',
      )}
      data-model-picker-row
      onFocus={() => setShowFastMode(true)}
      onMouseEnter={() => setShowFastMode(true)}
      onMouseLeave={() => setShowFastMode(false)}
    >
      <button
        aria-pressed={props.active}
        className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-2 dshx:overflow-hidden dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
        data-model-picker-option
        disabled={props.busy}
        onClick={() => props.onSelect(ModelPickerModel.selectionForModel(props.group, props.model, props.current))}
        type="button"
      >
        <ProviderMark label={props.group.name} provider={props.group.id} />
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-xs dshx:font-medium">
          {ModelPickerModel.displayName({ group: props.group, model: props.model })}
        </span>
      </button>
      <span
        className="dshx:w-[88px] dshx:shrink-0 dshx:truncate dshx:rounded-full dshx:bg-muted dshx:px-1.5 dshx:py-0.5 dshx:text-center dshx:text-[9px] dshx:text-muted-foreground"
        title={props.group.name}
      >
        {props.group.name}
      </span>
      {props.quota === undefined ? (
        <span className="dshx:w-8 dshx:shrink-0" />
      ) : (
        <span className="dshx:w-8 dshx:shrink-0 dshx:text-right dshx:text-[10px] dshx:text-success">{Math.round(props.quota)}%</span>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <button
            aria-label={`Reasoning effort: ${efforts[effortIndex]?.name ?? 'Default'}`}
            className="dshx:flex dshx:w-8 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:py-1 dshx:outline-none dshx:hover:bg-muted dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
            data-model-effort-trigger
            type="button"
          >
            <EffortBars active={effortIndex} count={efforts.length} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="dshx-root dshx:w-auto dshx:min-w-36 dshx:p-1.5" side="right">
          <div aria-label="Reasoning levels" className="dshx:flex dshx:items-center dshx:gap-1" data-model-effort-popover>
            {efforts.length === 0 ? (
              <span className="dshx:px-2 dshx:py-1 dshx:text-[10px] dshx:text-muted-foreground">Default</span>
            ) : (
              efforts.map((effort, index) => (
                <TooltipProvider key={effort.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        aria-label={effort.name}
                        aria-pressed={index === effortIndex}
                        className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-1 dshx:rounded dshx:px-1.5 dshx:py-1 dshx:text-[9px] dshx:text-muted-foreground dshx:hover:bg-muted dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
                        disabled={props.busy}
                        onClick={() =>
                          props.onEffort(
                            ModelPickerModel.selectionForEffort(
                              props.active && props.current !== null
                                ? props.current
                                : ModelPickerModel.selectionForModel(props.group, props.model, props.current),
                              effort.id,
                            ),
                          )
                        }
                        type="button"
                      >
                        <EffortBars active={index} count={efforts.length} compact />
                        <span>{effort.name}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{effort.description || effort.name}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
      <div className="dshx:flex dshx:w-6 dshx:shrink-0 dshx:items-center dshx:justify-center" data-model-fast-mode-inline>
        {showFastMode && <InlineFastModeToggle busy={props.busy} input={input} modelName={props.model.name} />}
      </div>
      <button
        aria-label={`Details for ${props.model.name}`}
        className="dshx:flex dshx:size-6 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:hover:bg-muted dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
        data-model-details-trigger
        onClick={props.onDetails}
        type="button"
      >
        <ChevronRightIcon className="dshx:size-3.5" />
      </button>
    </div>
  )
}

export const ModelEffortPicker = ({ locked, available, directory, load, select, sessionId }: Props) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [fastModeOverride, setFastModeOverride] = useState<{ readonly routeKey: string; readonly enabled: boolean } | null>(null)
  const [detailsRoute, setDetailsRoute] = useState<{ readonly provider: string; readonly model: string } | null>(null)
  const modelListRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const state = useSyncExternalStore(
    onStoreChange => directory.subscribe(onStoreChange),
    () => directory.getSnapshot(),
  )
  const filteredGroups = useMemo(() => ModelPickerModel.filterGroups(state.groups, query), [state.groups, query])
  const rows = useMemo(() => {
    const flattened = filteredGroups.flatMap(group => group.models.map(model => ({ group, model })))
    return [...flattened].sort(
      (left, right) =>
        Number(right.group.id === state.current?.provider && right.model.id === state.current.model) -
        Number(left.group.id === state.current?.provider && left.model.id === state.current.model),
    )
  }, [filteredGroups, state.current])
  const usage = useApiQuery(aiAccountsApi, 'usage')
  const current = state.current
  const currentFastModeRouteKey = current === null ? null : fastModeRouteKey({ sessionId, provider: current.provider, model: current.model })
  const selectedGroup = current === null ? undefined : state.groups.find(group => group.id === current.provider)
  const selectedModel = selectedGroup?.models.find(model => model.id === current?.model)
  const inspected = detailsRoute ?? (current === null ? null : current)
  const detailsGroup = inspected === null ? undefined : state.groups.find(group => group.id === inspected.provider)
  const detailsModel = detailsGroup?.models.find(model => model.id === inspected?.model)
  const detailsSelection =
    inspected === null
      ? null
      : {
          provider: inspected.provider,
          model: inspected.model,
          ...(current?.provider === inspected.provider && current.model === inspected.model && current.reasoningEffort !== undefined
            ? { reasoningEffort: current.reasoningEffort }
            : {}),
        }
  const detailEfforts = detailsModel?.reasoning?.efforts ?? []
  const detailEffortIndex = Math.max(
    0,
    detailEfforts.findIndex(effort => effort.id === (detailsSelection?.reasoningEffort ?? detailsModel?.reasoning?.defaultEffort)),
  )
  const [sliderIndex, setSliderIndex] = useState(detailEffortIndex)
  const busy = locked || state.status === 'selecting'
  const effortLabel = selectedModel === undefined ? (state.retainedEffort ?? 'Default') : ModelPickerModel.effortName(selectedModel, current)
  const settings = useSettings(modelEffortPickerSettings)
  const accountSwapEnabled = settings.value?.accountSwap ?? true
  const accountSwapRoutes = settings.value?.accountSwapRoutes
  const nextAccount = useMemo(
    () => (accountSwapEnabled ? ModelPickerModel.nextAccountSelection({ groups: state.groups, current, routes: accountSwapRoutes ?? [] }) : undefined),
    [accountSwapEnabled, accountSwapRoutes, state.groups, current],
  )
  const shortLabel = current === null ? undefined : ModelPickerModel.triggerLabel({ groups: state.groups, current })
  const triggerLabel = shortLabel?.model ?? current?.model ?? (state.status === 'loading' ? 'Loading models…' : 'Choose model')

  useEffect(() => {
    if (open && available) load()
    if (!open) {
      setQuery('')
      setSelectionError(null)
    }
  }, [open, available, load])

  useEffect(() => {
    if (accountSwapEnabled && available) load()
  }, [accountSwapEnabled, available, load])

  useEffect(() => {
    setSliderIndex(detailEffortIndex)
  }, [detailEffortIndex, detailsRoute?.provider, detailsRoute?.model])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      modelListRef.current?.querySelector('[data-model-picker-option][aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, selectedGroup?.id, selectedModel?.id])

  const submitSelection = async (selection: ModelSelection): Promise<void> => {
    setSelectionError(null)
    try {
      const result = await select(selection)
      if (result !== undefined && !result.ok) setSelectionError(result.error.message)
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : String(error))
    }
  }

  if (!available) return null

  return (
    <div className="dshx-root dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-0.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            aria-label={`${shortLabel?.title ?? triggerLabel}, reasoning ${effortLabel}`}
            className="dshx-root dshx:h-8 dshx:max-w-72 dshx:min-w-0 dshx:justify-start dshx:gap-1.5 dshx:px-2 dshx:text-left dshx:@max-pane-narrow:gap-1 dshx:@max-pane-narrow:has-[>svg]:px-1.5"
            disabled={locked}
            size="sm"
            variant="ghost"
          >
            {busy ? (
              <LoaderCircleIcon aria-hidden="true" className="dshx:size-4 dshx:animate-spin dshx:text-muted-foreground" />
            ) : current === null ? (
              <SparklesIcon aria-hidden="true" className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
            ) : (
              <FastModeIndicator
                enabledOverride={fastModeOverride?.routeKey === currentFastModeRouteKey ? fastModeOverride.enabled : undefined}
                model={current.model}
                provider={current.provider}
                sessionId={sessionId}
              />
            )}
            <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:leading-none">
              {shortLabel?.providerTag === undefined ? null : (
                <TooltipProvider delayDuration={500}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="dshx:shrink-0 dshx:text-[10px] dshx:font-semibold dshx:text-muted-foreground" data-model-picker-provider>
                        {shortLabel.providerTag}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{shortLabel.title}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {/* The name truncates with the composer row (a native container); the row's own compact flag drops the
                effort instead of the name, so the trigger always says which model answers. */}
              {shortLabel === undefined ? (
                <span
                  className="dshx:max-w-[clamp(3rem,calc(100cqw-21rem),12rem)] dshx:min-w-0 dshx:truncate dshx:text-xs dshx:font-medium"
                  data-model-picker-text
                >
                  {triggerLabel}
                </span>
              ) : (
                <TooltipProvider delayDuration={500}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="dshx:max-w-[clamp(3rem,calc(100cqw-21rem),12rem)] dshx:min-w-0 dshx:truncate dshx:text-xs dshx:font-medium"
                        data-model-picker-text
                      >
                        {triggerLabel}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{shortLabel.title}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <span aria-hidden="true" className="dshx:text-[10px] dshx:text-muted-foreground dshx:@max-pane-narrow:hidden dshx:in-data-model-compact:hidden">
                ·
              </span>
              <span
                className="dshx:shrink-0 dshx:rounded-full dshx:bg-muted dshx:px-1.5 dshx:py-0.5 dshx:text-[10px] dshx:text-muted-foreground dshx:in-data-model-compact:hidden"
                data-model-picker-effort
              >
                {effortLabel}
              </span>
            </span>
            <ChevronDownIcon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="dshx-root dshx:@container dshx:w-[min(42rem,calc(100vw-1rem))] dshx:overflow-hidden dshx:p-0"
          side="top"
          sideOffset={8}
        >
          <div
            className={cn(
              'dshx:grid dshx:max-h-[min(34rem,var(--radix-popover-content-available-height))] dshx:@max-pane-compact:grid-cols-1',
              detailsRoute !== null ? 'dshx:grid-cols-[minmax(15rem,0.82fr)_minmax(19rem,1.18fr)] dshx:divide-x dshx:divide-border' : 'dshx:grid-cols-1',
            )}
          >
            <section
              aria-label="Choose a model"
              className={cn('dshx:flex dshx:min-h-0 dshx:flex-col dshx:gap-2 dshx:p-2.5', detailsRoute !== null && 'dshx:@max-pane-compact:hidden')}
            >
              <label className="dshx:relative dshx:block dshx:shrink-0">
                <SearchIcon
                  aria-hidden="true"
                  className="dshx:absolute dshx:left-2.5 dshx:top-1/2 dshx:size-4 dshx:-translate-y-1/2 dshx:text-muted-foreground"
                />
                <Input
                  aria-label="Search models and accounts"
                  autoComplete="off"
                  autoFocus
                  className="dshx:h-8 dshx:pl-8 dshx:text-xs"
                  onChange={event => setQuery(event.currentTarget.value)}
                  onKeyDown={event => {
                    if (event.key !== 'ArrowDown') return
                    event.preventDefault()
                    modelListRef.current?.querySelector<HTMLButtonElement>('button[data-model-picker-option]:not(:disabled)')?.focus()
                  }}
                  placeholder="Search models…"
                  ref={searchInputRef}
                  value={query}
                />
              </label>
              <ScrollArea className="dshx:min-h-0 dshx:flex-1">
                <div
                  aria-label="Models and accounts"
                  className="dshx:space-y-0.5 dshx:pr-1"
                  onKeyDown={event => {
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                    const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-model-picker-option]:not(:disabled)'))
                    const index = options.findIndex(option => option === event.target)
                    if (index < 0) return
                    event.preventDefault()
                    const target = options[index + (event.key === 'ArrowDown' ? 1 : -1)]
                    if (target !== undefined) target.focus()
                    else if (event.key === 'ArrowUp' && index === 0) searchInputRef.current?.focus()
                  }}
                  ref={modelListRef}
                  role="list"
                >
                  {rows.map(({ group, model }) => {
                    const active = current?.provider === group.id && current.model === model.id
                    const quota = usage.data?.cards.find(card => card.instanceId === group.id)?.usage.windows[0]?.percentRemaining
                    return (
                      <ModelRow
                        active={active}
                        busy={busy}
                        current={current}
                        group={group}
                        key={`${group.id}:${model.id}`}
                        model={model}
                        onDetails={() => setDetailsRoute({ provider: group.id, model: model.id })}
                        onEffort={next => void submitSelection(next)}
                        onSelect={next => void submitSelection(next)}
                        quota={quota}
                        sessionId={sessionId}
                      />
                    )
                  })}
                  {rows.length === 0 && (
                    <p className="dshx:px-3 dshx:py-5 dshx:text-center dshx:text-xs dshx:text-muted-foreground">
                      {state.status === 'loading' ? 'Loading model catalog…' : 'No matching models.'}
                    </p>
                  )}
                </div>
              </ScrollArea>
              {state.failures.length > 0 && (
                <p className="dshx:text-xs dshx:text-muted-foreground">
                  {state.failures.length} provider{state.failures.length === 1 ? '' : 's'} could not load:{' '}
                  {state.failures.map(failure => failure.name).join(', ')}
                </p>
              )}
            </section>

            {detailsRoute !== null && (
              <div className="dshx:min-h-0 dshx:overflow-y-auto dshx:p-2.5">
                <div className="dshx:mb-2 dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                  <button
                    aria-label="Back to model list"
                    className="dshx:flex dshx:size-6 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded dshx:hover:bg-muted"
                    onClick={() => setDetailsRoute(null)}
                    type="button"
                  >
                    <ArrowLeftIcon className="dshx:size-3.5" />
                  </button>
                  {detailsGroup !== undefined && detailsModel !== undefined && (
                    <>
                      <ProviderMark label={detailsGroup.name} provider={detailsGroup.id} />
                      <p className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-semibold" data-model-picker-current>
                        {ModelPickerModel.displayName({ group: detailsGroup, model: detailsModel })}
                      </p>
                    </>
                  )}
                  {detailsSelection !== null && (
                    <FastModeSection
                      disabled={busy}
                      key={`${sessionId}:${detailsSelection.provider}:${detailsSelection.model}`}
                      onEnabledChange={enabled =>
                        setFastModeOverride({
                          enabled,
                          routeKey: fastModeRouteKey({ sessionId, provider: detailsSelection.provider, model: detailsSelection.model }),
                        })
                      }
                      model={detailsSelection.model}
                      provider={detailsSelection.provider}
                      sessionId={sessionId}
                    />
                  )}
                </div>
                {detailsModel !== undefined && (
                  <div aria-label="Available accounts" className="dshx:mb-2 dshx:flex dshx:flex-wrap dshx:gap-1" data-model-account-chips>
                    {state.groups
                      .filter(group => group.models.some(model => model.id === detailsModel.id))
                      .map(group => (
                        <button
                          aria-pressed={detailsSelection?.provider === group.id}
                          className={cn(
                            'dshx:rounded-full dshx:border dshx:border-border dshx:px-2 dshx:py-1 dshx:text-[10px] dshx:text-muted-foreground dshx:hover:bg-muted',
                            detailsSelection?.provider === group.id && 'dshx:border-primary/50 dshx:bg-accent dshx:text-foreground',
                          )}
                          key={group.id}
                          onClick={() => {
                            setDetailsRoute({ provider: group.id, model: detailsModel.id })
                            void submitSelection(ModelPickerModel.selectionForModel(group, detailsModel, current))
                          }}
                          type="button"
                        >
                          {group.name}
                        </button>
                      ))}
                  </div>
                )}

                {(selectionError ?? state.error) !== null && (
                  <div
                    className="dshx:mb-3 dshx:flex dshx:items-center dshx:justify-between dshx:gap-3 dshx:rounded-md dshx:border dshx:border-destructive/30 dshx:bg-destructive/10 dshx:px-3 dshx:py-2"
                    role="alert"
                  >
                    <p className="dshx:min-w-0 dshx:text-xs dshx:text-destructive">{selectionError ?? state.error}</p>
                    {state.error !== null && (
                      <Button onClick={load} size="xs" variant="outline">
                        Retry
                      </Button>
                    )}
                  </div>
                )}

                <section aria-label="Reasoning effort" className="dshx:space-y-1.5 dshx:py-1.5">
                  <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
                    <p className="dshx:text-xs dshx:font-semibold">Reasoning effort</p>
                    {detailsSelection !== null && (
                      <Button
                        aria-pressed={detailsSelection.reasoningEffort === undefined}
                        disabled={busy}
                        onClick={() => void submitSelection(ModelPickerModel.selectionForEffort(detailsSelection, undefined))}
                        size="xs"
                        variant="ghost"
                      >
                        <RotateCcwIcon aria-hidden="true" />
                        Default
                      </Button>
                    )}
                  </div>
                  {detailsModel === undefined || detailsSelection === null ? (
                    <p className="dshx:text-[10px] dshx:text-muted-foreground">No reasoning controls.</p>
                  ) : detailEfforts.length === 0 ? (
                    <p className="dshx:text-[10px] dshx:text-muted-foreground">No reasoning levels.</p>
                  ) : (
                    <div className="dshx:space-y-1">
                      {detailEfforts.length > 1 && (
                        <Slider
                          aria-label="Reasoning effort"
                          className="dshx:py-1 dshx:[&_[data-slot=slider-track]]:h-1.5 dshx:[&_[data-slot=slider-range]]:bg-primary dshx:[&_[data-slot=slider-thumb]]:z-[2] dshx:[&_[data-slot=slider-thumb]]:size-4 dshx:[&_[data-slot=slider-thumb]]:border-2 dshx:[&_[data-slot=slider-thumb]]:border-primary dshx:[&_[data-slot=slider-thumb]]:bg-background dshx:[&_[data-slot=slider-thumb]]:shadow-sm"
                          data-model-effort-slider
                          disabled={busy}
                          max={detailEfforts.length - 1}
                          min={0}

                          onValueChange={(values: number[]) => setSliderIndex(values[0] ?? 0)}
                          onValueCommit={(values: number[]) => {
                            const effort = detailEfforts[values[0] ?? 0]
                            if (effort !== undefined) void submitSelection(ModelPickerModel.selectionForEffort(detailsSelection, effort.id))
                          }}
                          step={1}
                          value={[Math.min(sliderIndex, detailEfforts.length - 1)]}
                        />
                      )}
                      <div className="dshx:flex dshx:justify-between dshx:gap-1" data-model-effort-options>
                        {detailEfforts.map((effort, index) => (
                          <button
                            aria-pressed={index === detailEffortIndex}
                            className={cn(
                              'dshx:rounded-sm dshx:px-1 dshx:py-0.5 dshx:text-[9px] dshx:text-muted-foreground dshx:hover:text-foreground',
                              index === detailEffortIndex && 'dshx:font-semibold dshx:text-foreground',
                            )}
                            data-model-effort-option
                            disabled={busy}
                            key={effort.id}
                            onClick={() => void submitSelection(ModelPickerModel.selectionForEffort(detailsSelection, effort.id))}
                            type="button"
                          >
                            {effort.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
                <FallbacksSection busy={busy} current={current} groups={state.groups} sessionId={sessionId} />
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {nextAccount !== undefined && (
        <TooltipProvider delayDuration={500}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={`Switch to ${nextAccount.group.name}`}
                className="dshx:shrink-0 dshx:text-muted-foreground dshx:hover:text-foreground"
                data-model-account-swap
                disabled={busy}
                onClick={() => void submitSelection(nextAccount.selection)}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <ArrowLeftRightIcon aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Switch to {nextAccount.group.name}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  )
}
