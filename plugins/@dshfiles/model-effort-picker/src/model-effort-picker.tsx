import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { useSettings } from '@dshfiles/dshx/client'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ScrollArea } from '@dshfiles/plugin-ui/components/ui/scroll-area'
import { Slider } from '@dshfiles/plugin-ui/components/ui/slider'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ArrowLeftRightIcon, CheckIcon, ChevronDownIcon, LoaderCircleIcon, RotateCcwIcon, SearchIcon, SparklesIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { FallbacksSection } from './fallbacks-section.js'
import { ModelPickerModel } from './model-picker-model.js'
import { modelEffortPickerSettings } from './settings.js'

type Props = ModelSelectInjected & { readonly locked: boolean; readonly sessionId: string }

export const ModelEffortPicker = ({ locked, available, directory, load, select, sessionId }: Props) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const modelListRef = useRef<HTMLDivElement>(null)
  const state = useSyncExternalStore(
    onStoreChange => directory.subscribe(onStoreChange),
    () => directory.getSnapshot(),
  )
  const filteredGroups = useMemo(() => ModelPickerModel.filterGroups(state.groups, query), [state.groups, query])
  const current = state.current
  const selectedGroup = current === null ? undefined : state.groups.find(group => group.id === current.provider)
  const selectedModel = selectedGroup?.models.find(model => model.id === current?.model)
  const efforts = selectedModel?.reasoning?.efforts ?? []
  const selectedEffort = current?.reasoningEffort ?? selectedModel?.reasoning?.defaultEffort
  const selectedEffortIndex = Math.max(
    0,
    efforts.findIndex(effort => effort.id === selectedEffort),
  )
  const [sliderIndex, setSliderIndex] = useState(selectedEffortIndex)
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
    if (!open) return
    const frame = requestAnimationFrame(() => {
      modelListRef.current?.querySelector('[data-model-picker-option][aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, selectedGroup?.id, selectedModel?.id])

  useEffect(() => {
    setSliderIndex(selectedEffortIndex)
  }, [selectedEffortIndex, selectedGroup?.id, selectedModel?.id])

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
            ) : (
              <SparklesIcon aria-hidden="true" className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
            )}
            <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:leading-none">
              {shortLabel?.providerTag === undefined ? null : (
                <span
                  className="dshx:shrink-0 dshx:text-[10px] dshx:font-semibold dshx:text-muted-foreground"
                  data-model-picker-provider
                  title={shortLabel.title}
                >
                  {shortLabel.providerTag}
                </span>
              )}
              {/* The name truncates with the composer row (a native container); the row's own compact flag drops the
                effort instead of the name, so the trigger always says which model answers. */}
              <span
                className="dshx:max-w-[clamp(3rem,calc(100cqw-21rem),12rem)] dshx:min-w-0 dshx:truncate dshx:text-xs dshx:font-medium"
                data-model-picker-text
                title={shortLabel?.title}
              >
                {triggerLabel}
              </span>
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
          className="dshx-root dshx:max-h-[min(44rem,var(--radix-popover-content-available-height))] dshx:w-[min(26rem,calc(100vw-1rem))] dshx:overflow-y-auto dshx:p-0"
          side="top"
          sideOffset={8}
        >
          <div className="dshx:space-y-2 dshx:p-3">
            <label className="dshx:relative dshx:block">
              <SearchIcon
                aria-hidden="true"
                className="dshx:absolute dshx:left-2.5 dshx:top-1/2 dshx:size-4 dshx:-translate-y-1/2 dshx:text-muted-foreground"
              />
              <Input
                aria-label="Search models and providers"
                autoComplete="off"
                autoFocus
                className="dshx:pl-9"
                onChange={event => setQuery(event.currentTarget.value)}
                placeholder="Search models or providers…"
                value={query}
              />
            </label>

            {selectedModel !== undefined && selectedGroup !== undefined && (
              <p className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:px-1 dshx:text-xs dshx:text-muted-foreground" data-model-picker-current>
                <CheckIcon aria-hidden="true" className="dshx:size-3.5 dshx:shrink-0 dshx:text-primary" />
                <span className="dshx:shrink-0">Using</span>
                <span className="dshx:min-w-0 dshx:truncate dshx:font-medium dshx:text-foreground">
                  {selectedGroup.name} / {ModelPickerModel.displayName({ group: selectedGroup, model: selectedModel })}
                </span>
              </p>
            )}

            <ScrollArea className="dshx:h-52 dshx:max-h-[36vh] dshx:min-h-24">
              <div aria-label="Models grouped by provider" className="dshx:space-y-2 dshx:p-2" ref={modelListRef} role="list">
                {filteredGroups.map(group => (
                  <section aria-label={group.name} className="dshx:space-y-1" key={group.id}>
                    <div className="dshx:px-2 dshx:py-1 dshx:text-[10px] dshx:font-semibold dshx:uppercase dshx:tracking-wide dshx:text-muted-foreground">
                      {group.name}
                    </div>
                    {group.models.map(model => {
                      const active = current?.provider === group.id && current.model === model.id
                      return (
                        <Button
                          aria-pressed={active}
                          className={cn('dshx:w-full dshx:justify-start dshx:gap-2 dshx:text-left', active && 'dshx:bg-accent')}
                          data-model-picker-option
                          disabled={busy}
                          key={`${group.id}:${model.id}`}
                          onClick={() => void submitSelection(ModelPickerModel.selectionForModel(group, model, current))}
                          size="sm"
                          variant="ghost"
                        >
                          <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{ModelPickerModel.displayName({ group, model })}</span>
                          <span className="dshx:max-w-28 dshx:truncate dshx:text-[10px] dshx:text-muted-foreground">{model.id}</span>
                          {active && <CheckIcon aria-hidden="true" className="dshx:size-4 dshx:shrink-0 dshx:text-primary" />}
                        </Button>
                      )
                    })}
                  </section>
                ))}
                {filteredGroups.length === 0 && (
                  <p className="dshx:px-3 dshx:py-6 dshx:text-center dshx:text-sm dshx:text-muted-foreground">
                    {state.status === 'loading' ? 'Loading model catalog…' : 'No matching models.'}
                  </p>
                )}
              </div>
            </ScrollArea>

            {(selectionError ?? state.error) !== null && (
              <div
                className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3 dshx:rounded-md dshx:border dshx:border-destructive/30 dshx:bg-destructive/10 dshx:px-3 dshx:py-2"
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

            {state.failures.length > 0 && (
              <p className="dshx:text-xs dshx:text-muted-foreground">
                {state.failures.length} provider{state.failures.length === 1 ? '' : 's'} could not load:{' '}
                {state.failures.map(failure => failure.name).join(', ')}
              </p>
            )}
          </div>

          <section aria-label="Reasoning effort" className="dshx:space-y-2 dshx:border-t dshx:border-border dshx:px-3 dshx:py-3">
            <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3">
              <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                <p className="dshx:text-sm dshx:font-semibold">Reasoning effort</p>
                <Badge variant="secondary">{effortLabel}</Badge>
              </div>
              {selectedModel !== undefined && current !== null && (
                <Button
                  aria-pressed={current.reasoningEffort === undefined}
                  disabled={busy}
                  onClick={() => void submitSelection(ModelPickerModel.selectionForEffort(current, undefined))}
                  size="xs"
                  variant="ghost"
                >
                  <RotateCcwIcon aria-hidden="true" />
                  Use provider default
                </Button>
              )}
            </div>

            {selectedModel === undefined || current === null ? (
              <p className="dshx:text-xs dshx:text-muted-foreground">Select a model to see its reasoning controls.</p>
            ) : efforts.length === 0 ? (
              <p className="dshx:text-xs dshx:text-muted-foreground">This model does not advertise reasoning levels.</p>
            ) : (
              <div className="dshx:space-y-2">
                {efforts.length > 1 && (
                  <div className="dshx:relative dshx:py-1">
                    <Slider
                      aria-label="Reasoning effort"
                      className="dshx:py-1 dshx:[&_[data-slot=slider-track]]:h-3 dshx:[&_[data-slot=slider-track]]:bg-border dshx:[&_[data-slot=slider-range]]:bg-info dshx:[&_[data-slot=slider-thumb]]:z-[2] dshx:[&_[data-slot=slider-thumb]]:size-6 dshx:[&_[data-slot=slider-thumb]]:border-2 dshx:[&_[data-slot=slider-thumb]]:border-info dshx:[&_[data-slot=slider-thumb]]:bg-background dshx:[&_[data-slot=slider-thumb]]:shadow-md"
                      data-model-effort-slider
                      disabled={busy}
                      max={efforts.length - 1}
                      min={0}
                      onValueChange={(values: number[]) => setSliderIndex(values[0] ?? 0)}
                      onValueCommit={(values: number[]) => {
                        const effort = efforts[values[0] ?? 0]
                        if (effort !== undefined) void submitSelection(ModelPickerModel.selectionForEffort(current, effort.id))
                      }}
                      step={1}
                      value={[sliderIndex]}
                    />
                    <div
                      aria-hidden="true"
                      className="dshx:pointer-events-none dshx:absolute dshx:inset-x-3 dshx:top-1/2 dshx:z-[1] dshx:flex dshx:-translate-y-1/2 dshx:items-center dshx:justify-between"
                      data-model-effort-slider-markers
                    >
                      {efforts.map((effort, index) => (
                        <span
                          className={cn('dshx:size-1 dshx:rounded-full', index <= sliderIndex ? 'dshx:bg-background/70' : 'dshx:bg-muted-foreground/50')}
                          data-model-effort-marker
                          key={effort.id}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div className="dshx:flex dshx:justify-between dshx:gap-2" data-model-effort-options>
                  {efforts.map((effort, index) => (
                    <button
                      aria-pressed={index === selectedEffortIndex}
                      className={cn(
                        'dshx:rounded-sm dshx:px-1 dshx:py-0.5 dshx:text-[10px] dshx:text-muted-foreground dshx:transition-colors dshx:hover:text-foreground dshx:focus-visible:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
                        index === selectedEffortIndex && 'dshx:font-semibold dshx:text-foreground',
                      )}
                      data-model-effort-option
                      disabled={busy}
                      key={effort.id}
                      onClick={() => void submitSelection(ModelPickerModel.selectionForEffort(current, effort.id))}
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
