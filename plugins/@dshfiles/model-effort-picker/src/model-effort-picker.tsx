import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ScrollArea } from '@dshfiles/plugin-ui/components/ui/scroll-area'
import { Slider } from '@dshfiles/plugin-ui/components/ui/slider'
import { CheckIcon, ChevronDownIcon, LoaderCircleIcon, RotateCcwIcon, SearchIcon, SparklesIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { effortName, filterModelGroups, selectionForEffort, selectionForModel } from './model-picker-model.js'

type Props = ModelSelectInjected & { readonly locked: boolean }

export const ModelEffortPicker = ({ locked, available, directory, load, select }: Props) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const state = useSyncExternalStore(
    onStoreChange => directory.subscribe(onStoreChange),
    () => directory.getSnapshot(),
  )
  const filteredGroups = useMemo(() => filterModelGroups(state.groups, query), [state.groups, query])
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
  const effortLabel = selectedModel === undefined ? (state.retainedEffort ?? 'Default') : effortName(selectedModel, current)
  const triggerLabel = selectedModel?.name ?? current?.model ?? (state.status === 'loading' ? 'Loading models…' : 'Choose model')

  useEffect(() => {
    if (open && available) load()
    if (!open) {
      setQuery('')
      setSelectionError(null)
    }
  }, [open, available, load])

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-label={`${triggerLabel}, reasoning ${effortLabel}`}
          className="dshx-root dshx:h-8 dshx:max-w-72 dshx:min-w-0 dshx:justify-start dshx:gap-1.5 dshx:px-2 dshx:text-left"
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
            <span
              className="dshx:min-w-0 dshx:truncate dshx:text-xs dshx:font-medium"
              data-model-picker-text
              style={{ display: 'var(--dsh-composer-model-text-display, inline)' }}
            >
              {triggerLabel}
            </span>
            <span aria-hidden="true" className="dshx:text-[10px] dshx:text-muted-foreground">
              ·
            </span>
            <span
              className="dshx:shrink-0 dshx:rounded-full dshx:bg-muted dshx:px-1.5 dshx:py-0.5 dshx:text-[10px] dshx:text-muted-foreground"
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
        className="dshx-root dshx:max-h-[min(82vh,36rem)] dshx:w-[min(26rem,calc(100vw-1rem))] dshx:overflow-hidden dshx:p-0"
        side="top"
        sideOffset={8}
      >
        <div className="dshx:space-y-2 dshx:p-3">
          <label className="dshx:relative dshx:block">
            <SearchIcon aria-hidden="true" className="dshx:absolute dshx:left-2.5 dshx:top-1/2 dshx:size-4 dshx:-translate-y-1/2 dshx:text-muted-foreground" />
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

          <ScrollArea className="dshx:h-52 dshx:max-h-[36vh] dshx:min-h-24">
            <div aria-label="Models grouped by provider" className="dshx:space-y-2 dshx:p-2" role="list">
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
                        disabled={busy}
                        key={`${group.id}:${model.id}`}
                        onClick={() => void submitSelection(selectionForModel(group, model, current))}
                        size="sm"
                        variant="ghost"
                      >
                        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{model.name}</span>
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
              {state.failures.length} provider{state.failures.length === 1 ? '' : 's'} could not load: {state.failures.map(failure => failure.name).join(', ')}
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
                onClick={() => void submitSelection(selectionForEffort(current, undefined))}
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
                      if (effort !== undefined) void submitSelection(selectionForEffort(current, effort.id))
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
                    onClick={() => void submitSelection(selectionForEffort(current, effort.id))}
                    type="button"
                  >
                    {effort.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </PopoverContent>
    </Popover>
  )
}
