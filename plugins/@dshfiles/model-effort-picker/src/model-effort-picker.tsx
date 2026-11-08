import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { useApiQuery, useSettings } from '@dshfiles/dshx/client'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { aiAccountsFastModeApi } from '@dshfiles/ai-accounts/model-fast-mode-api'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Kbd } from '@dshfiles/plugin-ui/components/ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ScrollArea } from '@dshfiles/plugin-ui/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ArrowLeftRightIcon, ChevronDownIcon, LoaderCircleIcon, SearchIcon, SparklesIcon, ZapIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { accountColor } from './account-color.js'
import { ModelDetails, type InspectedRoute } from './model-details.js'
import { ModelPickerModel } from './model-picker-model.js'
import { ModelRow } from './model-row.js'
import { PROVIDER_LABEL } from './provider-labels.js'
import { modelEffortPickerSettings } from './settings.js'

type Props = ModelSelectInjected & { readonly locked: boolean; readonly sessionId: string }
type FastModeRoute = { readonly sessionId: string; readonly provider: string; readonly model: string }

const fastModeRouteKey = ({ sessionId, provider, model }: FastModeRoute): string => JSON.stringify([sessionId, provider, model])

/** The popover never narrows below the side-by-side tier (`pane-compact`, 42rem) nor grows past this many rem. */
const POPOVER_MIN_REM = 42
const POPOVER_MAX_REM = 64

/**
 * How many pixels the list must grow so its longest model name shows in full (negative when every name has room to
 * spare). Measured on the rendered rows, because the provider and account columns beside a name vary per row.
 */
const nameWidthShortfall = (list: HTMLElement): number | undefined => {
  const range = document.createRange()
  let shortfall: number | undefined
  for (const name of list.querySelectorAll<HTMLElement>('[data-model-picker-name]')) {
    range.selectNodeContents(name)
    // Client rects carry the popover's zoom-in animation transform; offset sizes do not. Undo the scale.
    const box = name.getBoundingClientRect().width
    if (box === 0) continue
    const missing = Math.ceil((range.getBoundingClientRect().width * name.offsetWidth) / box) - name.offsetWidth
    shortfall = shortfall === undefined ? missing : Math.max(shortfall, missing)
  }
  return shortfall
}

/** The picker's own shortcut: focus the search field while it is open. */
const MOD_KEY = typeof navigator !== 'undefined' && /mac|iphone|ipad/iu.test(navigator.userAgent) ? '⌘' : 'Ctrl'

const FastModeIndicator = ({ sessionId, provider, model, enabledOverride }: FastModeRoute & { readonly enabledOverride: boolean | undefined }) => {
  const state = useApiQuery(aiAccountsFastModeApi, 'status', { input: { sessionId, provider, model } })
  if (enabledOverride ?? state.data?.enabled ?? false)
    return <ZapIcon aria-hidden="true" className="dshx:size-4 dshx:shrink-0 dshx:text-warning" data-model-fast-mode-enabled />
  return <SparklesIcon aria-hidden="true" className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
}

export const ModelEffortPicker = ({ locked, available, directory, load, select, sessionId }: Props) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [fastModeOverride, setFastModeOverride] = useState<{ readonly routeKey: string; readonly enabled: boolean } | null>(null)
  const [inspected, setInspected] = useState<InspectedRoute | null>(null)
  const [narrowDetails, setNarrowDetails] = useState(false)
  const [popoverWidth, setPopoverWidth] = useState<number | null>(null)
  const modelListRef = useRef<HTMLDivElement | null>(null)
  // The popover's Portal mounts its content one render after `open`, so the fit below waits for the list node itself.
  const [listNode, setListNode] = useState<HTMLDivElement | null>(null)
  const attachModelList = useCallback((node: HTMLDivElement | null) => {
    modelListRef.current = node
    setListNode(node)
  }, [])
  const detailsRef = useRef<HTMLDivElement>(null)
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
  const profiles = useApiQuery(aiAccountsApi, 'read')
  const providerLabels = useMemo(
    () => new Map((profiles.data?.accounts ?? []).map(profile => [profile.instanceId, PROVIDER_LABEL[profile.kind]])),
    [profiles.data],
  )
  const accountAccents = useMemo(
    () =>
      new Map(
        (profiles.data?.accounts ?? []).map(profile => [
          profile.instanceId,
          accountColor({ accentColor: profile.accentColor, instanceId: profile.instanceId }),
        ]),
      ),
    [profiles.data],
  )
  const current = state.current
  const currentFastModeRouteKey = current === null ? null : fastModeRouteKey({ sessionId, provider: current.provider, model: current.model })
  const selectedGroup = current === null ? undefined : state.groups.find(group => group.id === current.provider)
  const selectedModel = selectedGroup?.models.find(model => model.id === current?.model)
  const inspectedRoute: InspectedRoute | null = inspected ?? (current === null ? null : { model: current.model, provider: current.provider })
  const busy = locked || state.status === 'selecting'
  const effortLabel = selectedModel === undefined ? (state.retainedEffort ?? 'Default') : ModelPickerModel.effortName(selectedModel, current)
  const settings = useSettings(modelEffortPickerSettings)
  const accountSwapEnabled = settings.value?.accountSwap ?? true
  const accountSwapRoutes = settings.value?.accountSwapRoutes
  const nextAccount = useMemo(
    () => (accountSwapEnabled ? ModelPickerModel.nextAccountSelection({ current, groups: state.groups, routes: accountSwapRoutes ?? [] }) : undefined),
    [accountSwapEnabled, accountSwapRoutes, state.groups, current],
  )
  const shortLabel = current === null ? undefined : ModelPickerModel.triggerLabel({ groups: state.groups, current })
  const triggerLabel = shortLabel?.model ?? current?.model ?? (state.status === 'loading' ? 'Loading models…' : 'Choose model')

  useEffect(() => {
    if (open && available) load()
    if (!open) {
      setQuery('')
      setSelectionError(null)
      setInspected(null)
      setNarrowDetails(false)
      setPopoverWidth(null)
    }
  }, [open, available, load])

  // Fit the popover to the longest model name, between the side-by-side minimum and a cap, before it paints. Sized on
  // the full list only, so typing a search never resizes it under the cursor.
  useLayoutEffect(() => {
    if (!open || query !== '' || rows.length === 0) return
    const popover = listNode?.closest<HTMLElement>('[data-slot=popover-content]') ?? null
    if (popover === null || listNode === null) return
    const shortfall = nameWidthShortfall(listNode)
    if (shortfall === undefined || Math.abs(shortfall) < 1) return
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const max = Math.min(POPOVER_MAX_REM * rem, window.innerWidth - rem)
    const next = Math.min(max, Math.max(POPOVER_MIN_REM * rem, popover.offsetWidth + shortfall))
    setPopoverWidth(width => (width !== null && Math.abs(width - next) < 1 ? width : next))
  }, [open, query, rows, listNode])

  useEffect(() => {
    if (accountSwapEnabled && available) load()
  }, [accountSwapEnabled, available, load])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      modelListRef.current?.querySelector('[data-model-picker-option][aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, query, rows.length, selectedGroup?.id, selectedModel?.id])

  const submitSelection = async (selection: ModelSelection): Promise<void> => {
    setSelectionError(null)
    try {
      const result = await select(selection)
      if (result !== undefined && !result.ok) setSelectionError(result.error.message)
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : String(error))
    }
  }

  const choose = (selection: ModelSelection): void => {
    setInspected({ model: selection.model, provider: selection.provider })
    void submitSelection(selection)
  }

  const showDetails = (route: InspectedRoute): void => {
    setInspected(route)
    setNarrowDetails(true)
    requestAnimationFrame(() => detailsRef.current?.focus())
  }

  if (!available) return null

  return (
    <TooltipProvider delayDuration={250}>
      <div className="dshx-root dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-0.5">
        <Popover onOpenChange={setOpen} open={open}>
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="dshx:shrink-0 dshx:text-[10px] dshx:font-semibold dshx:text-muted-foreground" data-model-picker-provider>
                        {shortLabel.providerTag}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{shortLabel.title}</TooltipContent>
                  </Tooltip>
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
            className="dshx-root dshx:w-[min(50rem,calc(100vw-1rem))] dshx:border-0 dshx:bg-transparent dshx:p-0 dshx:shadow-none"
            style={popoverWidth === null ? undefined : { width: popoverWidth }}
            onOpenAutoFocus={event => {
              event.preventDefault()
              searchInputRef.current?.focus()
            }}
            onEscapeKeyDown={(event: KeyboardEvent) => {
              if (!narrowDetails || !window.matchMedia('(max-width: 43rem)').matches) return
              event.preventDefault()
              setNarrowDetails(false)
              requestAnimationFrame(() => searchInputRef.current?.focus())
            }}
            side="top"
            sideOffset={8}
          >
            <div
              className="dshx:@container dshx:flex dshx:items-start dshx:gap-2.5"
              onKeyDownCapture={event => {
                if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  searchInputRef.current?.focus()
                }
              }}
            >
              <section
                aria-label="Choose a model"
                className={cn(
                  'dshx:flex dshx:max-h-[min(26rem,var(--radix-popover-content-available-height))] dshx:min-h-[18rem] dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1.5 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-popover dshx:p-1.5 dshx:shadow-lg',
                  'dshx:@max-pane-compact:w-full',
                  narrowDetails && 'dshx:@max-pane-compact:hidden',
                )}
              >
                <label className="dshx:relative dshx:block dshx:shrink-0">
                  <SearchIcon
                    aria-hidden="true"
                    className="dshx:pointer-events-none dshx:absolute dshx:left-2 dshx:top-1/2 dshx:size-3.5 dshx:-translate-y-1/2 dshx:text-muted-foreground"
                  />
                  <Input
                    aria-label="Search models and accounts"
                    autoComplete="off"
                    className="dshx:h-7 dshx:rounded-lg dshx:border-border dshx:bg-muted/40 dshx:pl-7 dshx:pr-11 dshx:text-[11px] dshx:focus-visible:ring-1 dshx:focus-visible:ring-info/60"
                    onChange={event => setQuery(event.currentTarget.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        const first = rows[0]
                        if (first === undefined || busy) return
                        event.preventDefault()
                        choose(ModelPickerModel.selectionForModel(first.group, first.model, current))
                        return
                      }
                      if (event.key !== 'ArrowDown') return
                      event.preventDefault()
                      modelListRef.current?.querySelector<HTMLButtonElement>('button[data-model-picker-option]:not(:disabled)')?.focus()
                    }}
                    placeholder="Search models…"
                    ref={searchInputRef}
                    value={query}
                  />
                  <Kbd className="dshx:pointer-events-none dshx:absolute dshx:right-1.5 dshx:top-1/2 dshx:h-4 dshx:-translate-y-1/2 dshx:px-1 dshx:text-[9px]">
                    {MOD_KEY} K
                  </Kbd>
                </label>
                <ScrollArea className="dshx:min-h-0 dshx:flex-1 dshx:[&_[data-slot=scroll-area-viewport]>div]:block!">
                  <div
                    aria-label="Models and accounts"
                    className="dshx:flex dshx:flex-col dshx:gap-px dshx:pr-1"
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
                    ref={attachModelList}
                    role="list"
                  >
                    {rows.map(({ group, model }) => {
                      const active = current?.provider === group.id && current.model === model.id
                      const quota = ModelPickerModel.quota(usage.data?.cards.find(card => card.instanceId === group.id))
                      return (
                        <ModelRow
                          accountAccent={accountAccents.get(group.id)}
                          active={active}
                          busy={busy}
                          current={current}
                          group={group}
                          key={`${group.id}:${model.id}`}
                          model={model}
                          onEffort={choose}
                          onInspect={() => showDetails({ model: model.id, provider: group.id })}
                          onSelect={choose}
                          providerLabel={providerLabels.get(group.id)}
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
                  <p className="dshx:px-1 dshx:text-[10px] dshx:text-muted-foreground">
                    {state.failures.length} provider{state.failures.length === 1 ? '' : 's'} could not load:{' '}
                    {state.failures.map(failure => failure.name).join(', ')}
                  </p>
                )}
              </section>

              <div
                className={cn(
                  'dshx:relative dshx:flex dshx:max-h-[min(26rem,var(--radix-popover-content-available-height))] dshx:w-72 dshx:min-w-0 dshx:shrink-0 dshx:flex-col dshx:rounded-xl dshx:border dshx:border-border dshx:bg-popover dshx:p-2.5 dshx:shadow-lg dshx:outline-none',
                  'dshx:@max-pane-compact:w-full',
                  !narrowDetails && 'dshx:@max-pane-compact:hidden',
                )}
                ref={detailsRef}
                tabIndex={-1}
              >
                <span
                  aria-hidden="true"
                  className="dshx:absolute dshx:-left-1 dshx:top-7 dshx:size-2 dshx:rotate-45 dshx:rounded-[1px] dshx:border-b dshx:border-l dshx:border-border dshx:bg-popover"
                />
                <div className="dshx:min-h-0 dshx:overflow-y-auto">
                  <ModelDetails
                    accountAccents={accountAccents}
                    busy={busy}
                    current={current}
                    error={selectionError ?? state.error}
                    groups={state.groups}
                    inspected={inspectedRoute}
                    onBack={() => {
                      setNarrowDetails(false)
                      requestAnimationFrame(() => searchInputRef.current?.focus())
                    }}
                    onClose={() => setOpen(false)}
                    onFastModeChange={enabled =>
                      setFastModeOverride(
                        inspectedRoute === null
                          ? null
                          : { enabled, routeKey: fastModeRouteKey({ model: inspectedRoute.model, provider: inspectedRoute.provider, sessionId }) },
                      )
                    }
                    onInspect={setInspected}
                    onRetry={load}
                    onSelect={choose}
                    providerLabels={providerLabels}
                    sessionId={sessionId}
                  />
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        {nextAccount === undefined ? null : (
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
        )}
      </div>
    </TooltipProvider>
  )
}
