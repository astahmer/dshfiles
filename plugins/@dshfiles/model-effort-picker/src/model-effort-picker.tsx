import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import { useApi, useApiQuery, useResource, useSettings } from '@dshfiles/dshx/client'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { aiAccountsFastModeApi } from '@dshfiles/ai-accounts/model-fast-mode-api'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ScrollArea } from '@dshfiles/plugin-ui/components/ui/scroll-area'
import { SearchInput } from '@dshfiles/plugin-ui/components/ui/search-input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ArrowLeftRightIcon, ChevronDownIcon, CpuIcon, LoaderCircleIcon, XIcon, ZapIcon } from '@dshfiles/plugin-ui/icons'
import { useHostConnection } from '@dshfiles/plugin-ui/lib/host-connection'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { AccountColor } from './account-color.js'
import { AccountDot } from './account-dot.js'
import { ListEmptyState } from './empty-state.js'
import { FanOutSelection } from './fan-out-bar.js'
import { FallbacksSection } from './fallbacks-section.js'
import { FastModeSection } from './fast-mode-section.js'
import { ModelDetails, type InspectedRoute } from './model-details.js'
import { ModelPickerModel } from './model-picker-model.js'
import { ModelRow } from './model-row.js'
import { BrandMark } from './picker-atoms.js'
import { PROVIDER_LABEL } from './provider-labels.js'
import { requestFanOut } from '@dshfiles/thread-sidebar/fan-out-request'
import { englishModelPicker, type ModelPickerTranslate } from './locales.js'
import { modelEffortPickerSettings } from './settings.js'
import { selectionFailureNotice } from './session-presence.js'

type Props = Omit<ModelSelectInjected, 'resolveText'> & {
  readonly locked: boolean
  readonly sessionId: string
  /** Opens AI accounts (N4: the way forward when no account offers a model). */
  readonly openAccounts?: () => void
  /** The picker's locale seat (`dshfiles.modelPicker`); English when absent. */
  readonly t?: (key: string, params?: Readonly<Record<string, string | number>>) => string
}
type FastModeRoute = { readonly sessionId: string; readonly provider: string; readonly model: string }

const fastModeRouteKey = ({ sessionId, provider, model }: FastModeRoute): string => JSON.stringify([sessionId, provider, model])

const FastModeIndicator = ({
  sessionId,
  provider,
  model,
  enabledOverride,
  onKnown,
}: FastModeRoute & { readonly enabledOverride: boolean | undefined; readonly onKnown: (enabled: boolean) => void }) => {
  // Every picker showing this Session mounts its indicator within the same landing; the page-wide resource reads the
  // route once for all of them (5 s covers the later mounts, a toggle shows through `enabledOverride` meanwhile).
  const state = useResource(aiAccountsFastModeApi, 'status', { sessionId, provider, model }, { staleTime: 5_000 })
  const known = state.data?.available === true ? state.data.enabled : undefined
  useEffect(() => {
    if (known !== undefined) onKnown(known)
  }, [known, onKnown])
  // Composer redesign (b:v9yh): the chip is plain text; only a live state (Fast mode on) earns a glyph, in ink (C2: amber
  // means low quota).
  if (enabledOverride ?? state.data?.enabled ?? false)
    return (
      // Round 3 R18: 4 px from the brand mark on a phone bar, whose mark step removes the chip gap.
      <ZapIcon aria-hidden="true" className="dshx:size-4 dshx:shrink-0 dshx:text-foreground dshx:in-data-model-mark:mr-1" data-model-fast-mode-enabled />
    )
  return null
}

export const ModelEffortPicker = ({ locked, available, directory, load, select, sessionId, openAccounts, t: seat }: Props) => {
  const t: ModelPickerTranslate = seat === undefined ? englishModelPicker : (key, params) => seat(key, params)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [fastModeOverride, setFastModeOverride] = useState<{ readonly routeKey: string; readonly enabled: boolean } | null>(null)
  const [inspected, setInspected] = useState<InspectedRoute | null>(null)
  const [narrowDetails, setNarrowDetails] = useState(false)
  const [fanOut, setFanOut] = useState<readonly ModelSelection[]>([])
  // C5: the search is a combobox over the listbox; `activeIndex` is the row it points at, ringed while the keyboard moves.
  const listboxId = useId()
  const [activeIndex, setActiveIndex] = useState(-1)
  // Round 4 T1: whether the active option was reached with the keyboard (an outline joins its wash), not the pointer.
  const [keyboardRow, setKeyboardRow] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  // Routes whose Fast mode state is known (the trigger's route, each inspected route): the list marks those that are on.
  const [knownFast, setKnownFast] = useState<ReadonlyMap<string, boolean>>(new Map())
  const rememberFast = useCallback((route: { readonly provider: string; readonly model: string }, enabled: boolean) => {
    const key = fastModeRouteKey({ sessionId: '', ...route })
    setKnownFast(previous => (previous.get(key) === enabled ? previous : new Map(previous).set(key, enabled)))
  }, [])
  // b:ysaj: Select several makes a click collect routes, so fan-out is not a shift-click secret (and works on touch).
  const [several, setSeveral] = useState(false)
  const modelListRef = useRef<HTMLDivElement | null>(null)
  const attachModelList = useCallback((node: HTMLDivElement | null) => {
    modelListRef.current = node
    // C5: the search is the list's one tab stop. Chrome makes a scroller with no focusable children a tab stop of its
    // own (the options are reached through aria-activedescendant), so the viewport opts out.
    node?.closest('[data-slot="scroll-area-viewport"]')?.setAttribute('tabindex', '-1')
  }, [])
  const detailsRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const state = useSyncExternalStore(
    onStoreChange => directory.subscribe(onStoreChange),
    () => directory.getSnapshot(),
  )
  const filteredGroups = useMemo(() => ModelPickerModel.filterGroups(state.groups, query), [state.groups, query])
  // Only the open menu shows account labels and quotas; reading them on mount cost two requests per thread switch.
  const usage = useApiQuery(aiAccountsApi, 'usage', { enabled: open })
  const profiles = useApiQuery(aiAccountsApi, 'read', { enabled: open })
  const providerLabels = useMemo(
    () => new Map((profiles.data?.accounts ?? []).map(profile => [profile.instanceId, PROVIDER_LABEL[profile.kind]])),
    [profiles.data],
  )
  // b:16yr: one row per model; the detail panel chooses the account.
  const selected = state.current
  const rows = useMemo(() => ModelPickerModel.modelRows({ groups: filteredGroups, current: selected }), [filteredGroups, selected])
  const quotas = useMemo(
    () =>
      new Map(
        (usage.data?.cards ?? []).flatMap(card => {
          const quota = ModelPickerModel.quota(card)
          return quota === undefined ? [] : [[card.instanceId, quota] as const]
        }),
      ),
    [usage.data],
  )
  // N2: a distinct dot per account within one service, and the account's own short tag ("CC2").
  const accountAccentMap = useMemo(() => AccountColor.accents(profiles.data?.accounts ?? []), [profiles.data])
  const fanOutTagOf = (provider: string): string =>
    accountBadges.get(provider) ?? ModelPickerModel.accountTag({ name: state.groups.find(group => group.id === provider)?.name ?? provider })
  const accountBadges = useMemo(
    () =>
      new Map(
        (profiles.data?.accounts ?? []).map(profile => [profile.instanceId, ModelPickerModel.accountTag({ name: profile.displayName, badge: profile.badge })]),
      ),
    [profiles.data],
  )
  const current = state.current
  const currentFastModeRouteKey = current === null ? null : fastModeRouteKey({ sessionId, provider: current.provider, model: current.model })
  const selectedGroup = current === null ? undefined : state.groups.find(group => group.id === current.provider)
  const selectedModel = selectedGroup?.models.find(model => model.id === current?.model)
  const inspectedRoute: InspectedRoute | null = inspected ?? (current === null ? null : { model: current.model, provider: current.provider })
  const busy = locked || state.status === 'selecting'
  // N4: no account offers a model: one message with its way forward, and no inspector of a model that is not there.
  const catalogEmpty = state.status !== 'loading' && state.groups.every(group => group.models.length === 0)
  const emptyState = ModelPickerModel.emptyState({ status: state.status, query, rowCount: rows.length, catalogEmpty })
  const effortLabel = selectedModel === undefined ? state.retainedEffort : ModelPickerModel.effortName(selectedModel, current)
  const settings = useSettings(modelEffortPickerSettings)
  const accountSwapEnabled = settings.value?.accountSwap ?? false
  const accountSwapRoutes = settings.value?.accountSwapRoutes
  const nextAccount = useMemo(
    () => (accountSwapEnabled ? ModelPickerModel.nextAccountSelection({ current, groups: state.groups, routes: accountSwapRoutes ?? [] }) : undefined),
    [accountSwapEnabled, accountSwapRoutes, state.groups, current],
  )
  const shortLabel = current === null ? undefined : ModelPickerModel.triggerLabel({ groups: state.groups, current })
  const triggerLabel = shortLabel?.model ?? current?.model ?? (state.status === 'loading' ? 'Loading models…' : 'Choose model')
  const triggerBrand = ModelPickerModel.triggerBrand({ groups: state.groups, current })

  useEffect(() => {
    if (open && available) load()
    if (!open) {
      setQuery('')
      setSelectionError(null)
      setInspected(null)
      setNarrowDetails(false)
    }
  }, [open, available, load])

  // The chip's name, its account tag (b:4qjm) and its accessible name all come from the catalog: read it as soon as the
  // picker is available, not only once its menu opens.
  // A catalog read that failed while DSH was away is read again once it answers (a fresh catalog answers from cache).
  const connection = useHostConnection()
  useEffect(() => {
    if (available && connection === 'online') load()
  }, [available, connection, load])

  // Opening or typing points the combobox at the model in use (the first row) and announces the result count.
  useEffect(() => {
    if (!open) return
    setActiveIndex(
      rows.length === 0
        ? -1
        : Math.max(
            0,
            rows.findIndex(row => row.active),
          ),
    )
    if (query.trim() !== '') setAnnouncement(ModelPickerModel.resultAnnouncement({ query, count: rows.length }))
  }, [open, query, rows])

  useEffect(() => {
    if (!open || activeIndex < 0) return
    const frame = requestAnimationFrame(() => document.getElementById(`${listboxId}-${String(activeIndex)}`)?.scrollIntoView({ block: 'nearest' }))
    return () => cancelAnimationFrame(frame)
  }, [open, activeIndex, listboxId])

  const fastApi = useApi(aiAccountsFastModeApi)

  const submitSelection = async (selection: ModelSelection): Promise<void> => {
    setSelectionError(null)
    try {
      const result = await select(selection)
      if (result !== undefined && !result.ok) {
        setSelectionError(selectionFailureNotice(result.error.message))
        return
      }
      const group = state.groups.find(candidate => candidate.id === selection.provider)
      const model = group?.models.find(candidate => candidate.id === selection.model)
      setAnnouncement(`Switched to ${group === undefined || model === undefined ? selection.model : ModelPickerModel.displayName({ group, model })}`)
    } catch (error) {
      setSelectionError(selectionFailureNotice(error instanceof Error ? error.message : String(error)))
    }
  }

  const choose = (selection: ModelSelection): void => {
    setInspected({ model: selection.model, provider: selection.provider })
    void submitSelection(selection)
  }

  /** S1: "Use ‹model›" commits a draft, then the Fast mode it staged (a per-thread route setting). */
  const useDraft = async (selection: ModelSelection, fast: boolean | undefined): Promise<void> => {
    setInspected({ model: selection.model, provider: selection.provider })
    await submitSelection(selection)
    if (fast === undefined) return
    try {
      const updated = await fastApi.setFast({ sessionId, provider: selection.provider, model: selection.model, enabled: fast })
      setFastModeOverride({ enabled: updated.enabled, routeKey: fastModeRouteKey({ sessionId, provider: selection.provider, model: selection.model }) })
      rememberFast(selection, updated.enabled)
    } catch (error) {
      setSelectionError(selectionFailureNotice(error instanceof Error ? error.message : String(error)))
    }
  }

  /** Shift-click collects routes for one fan-out request instead of switching this thread's model. */
  const toggleFanOut = (selection: ModelSelection): void => {
    // A shift-click or long-press collects a route straight into select mode, so the bar and the checkboxes show it.
    setSeveral(true)
    setFanOut(previous => ModelPickerModel.toggledFanOut(previous, selection))
  }

  const startFanOut = (): void => {
    if (fanOut.length < 2) return
    requestFanOut(
      fanOut.map(route => {
        const selected = { provider: route.provider, model: route.model }
        return route.reasoningEffort === undefined ? selected : { ...selected, reasoningEffort: route.reasoningEffort }
      }),
    )
    setFanOut([])
    setSeveral(false)
    setOpen(false)
  }

  const showDetails = (route: InspectedRoute): void => {
    setInspected(route)
    setNarrowDetails(true)
    requestAnimationFrame(() => detailsRef.current?.focus())
  }

  /** Details → the list (C5: Left or Escape; a draft is discarded), focus back on the search with its row. */
  const backToList = (): void => {
    setInspected(null)
    setNarrowDetails(false)
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }

  const useRow = (index: number, collect: boolean): void => {
    const row = rows[index]
    if (row === undefined || busy) return
    const selection = ModelPickerModel.selectionForModel(row.group, row.model, current)
    if (collect || several) toggleFanOut(selection)
    else choose(selection)
  }

  if (!available) return null

  return (
    <TooltipProvider delayDuration={500}>
      <div className="dshx-root dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-0.5">
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger asChild>
            {/* Drawn at the bar's 32 px chip height on touch too: the composer row gives each of its buttons a 44 pt hit area
                (InputBar.module.css), and a 44 px trigger regrew the row and put Send off its axis (council round 34 A2). */}
            <Button
              aria-label={`${shortLabel?.title ?? triggerLabel}, reasoning ${effortLabel ?? 'provider default'}`}
              className="dshx-root dshx:h-8 dshx:max-w-72 dshx:min-w-20 dshx:in-data-model-icon:min-w-0 dshx:shrink dshx:justify-start dshx:gap-1 dshx:px-2 dshx:text-left dshx:@max-pane-narrow:px-1.5 dshx:in-data-model-icon:px-1"
              data-model-trigger=""
              disabled={locked}
              size="sm"
              variant="ghost"
            >
              {busy ? (
                <LoaderCircleIcon aria-hidden="true" className="dshx:size-4 dshx:animate-spin dshx:text-muted-foreground" />
              ) : current === null ? null : (
                <FastModeIndicator
                  enabledOverride={fastModeOverride?.routeKey === currentFastModeRouteKey ? fastModeOverride.enabled : undefined}
                  model={current.model}
                  onKnown={enabled => rememberFast(current, enabled)}
                  provider={current.provider}
                  sessionId={sessionId}
                />
              )}
              {/* A bar too narrow for even the name (the composer row's data-model-icon, b:gyk7) shows the model as an icon;
                  its name stays in the tooltip and the accessible name. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <CpuIcon
                    aria-hidden="true"
                    className="dshx:hidden dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground dshx:in-data-model-icon:block"
                    data-model-picker-icon
                  />
                </TooltipTrigger>
                <TooltipContent>{shortLabel === undefined ? triggerLabel : `${triggerLabel} · ${shortLabel.title}`}</TooltipContent>
              </Tooltip>
              <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:leading-none dshx:in-data-model-icon:hidden">
                {/* The family mark is identity beside the name; it never shrinks, the name truncates first. */}
                {triggerBrand === undefined ? null : <BrandMark brand={triggerBrand} className="dshx:size-3.5" name={triggerLabel} />}
                {shortLabel?.providerTag === undefined || current === null ? null : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1"
                        data-model-picker-provider
                        data-off-default={shortLabel.offDefault === true || undefined}
                      >
                        {/* Round 3 R8: the default account reads muted at 500; another account in ink at 600 after its dot. */}
                        {shortLabel.offDefault === true ? (
                          <span className="dshx:flex" data-model-picker-account-dot>
                            <AccountDot
                              accent={accountAccentMap.get(current.provider) ?? AccountColor.of({ instanceId: current.provider })}
                              className="dshx:size-1.5"
                            />
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            'dshx:text-2xs',
                            shortLabel.offDefault === true ? 'dshx:font-semibold dshx:text-foreground' : 'dshx:font-medium dshx:text-muted-foreground',
                          )}
                        >
                          {accountBadges.get(current.provider) ?? shortLabel.providerTag}
                        </span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{shortLabel.title}</TooltipContent>
                  </Tooltip>
                )}
                {/* The name truncates with the composer row (a native container); the row's own compact flag drops the
                  effort instead of the name, so the trigger always says which model answers. */}
                {shortLabel === undefined ? (
                  <span
                    className="dshx:max-w-[clamp(4rem,calc(100cqw-15rem),14rem)] dshx:min-w-0 dshx:truncate dshx:text-xs dshx:font-medium"
                    data-model-picker-text
                  >
                    {triggerLabel}
                  </span>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="dshx:max-w-[clamp(4rem,calc(100cqw-15rem),14rem)] dshx:min-w-0 dshx:truncate dshx:text-xs dshx:font-medium"
                        data-model-picker-text
                      >
                        {triggerLabel}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{shortLabel.title}</TooltipContent>
                  </Tooltip>
                )}
                {effortLabel === undefined ? null : (
                  <>
                    <span aria-hidden="true" className="dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden dshx:in-data-model-compact:hidden">
                      ·
                    </span>
                    <span
                      className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden dshx:in-data-model-compact:hidden"
                      data-model-picker-effort
                    >
                      {effortLabel}
                    </span>
                  </>
                )}
              </span>
              <ChevronDownIcon
                aria-hidden="true"
                className="dshx:size-3 dshx:shrink-0 dshx:text-muted-foreground dshx:opacity-60 dshx:in-data-model-icon:hidden"
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="dshx-root dshx:@container dshx:w-[min(42.5625rem,calc(100vw-1.5rem))] dshx:overflow-clip! dshx:rounded-xl dshx:border dshx:border-border dshx:bg-popover dshx:p-0 dshx:shadow-lg dshx:in-[html[data-shell-phone-nav]]:bg-popover!"
            // Round 3 R7: on the phone the sheet takes the kit sheet's fill (the popover step), not the raised tone the
            // composer gives the sheets it opens, which equals the selected wash and the segment track.
            collisionPadding={12}
            // Round 3 R4: the root never scrolls (only the list and the details body do). overflow: hidden still let
            // scrollIntoView scroll it, which sheared the picker by 12–404 px; `clip` cannot scroll, and its !important
            // (a layered utility) outranks the kit phone sheet's overflow-y: auto !important.
            onOpenAutoFocus={event => {
              event.preventDefault()
              // On a touch screen a focused search raises the on-screen keyboard over the sheet: nothing takes focus, and the
              // search keyboard comes up only when the user taps the field.
              if (window.matchMedia('(pointer: coarse)').matches) return
              searchInputRef.current?.focus()
            }}
            onEscapeKeyDown={(event: KeyboardEvent) => {
              // Escape walks back one level (C5): details → the list, then the list → the trigger (Radix closes).
              const inDetails = detailsRef.current?.contains(document.activeElement) === true
              if (!inDetails && !(narrowDetails && window.matchMedia('(max-width: 43rem)').matches)) return
              event.preventDefault()
              backToList()
            }}
            side="top"
            sideOffset={8}
          >
            <div
              className="dshx:relative dshx:flex dshx:h-[min(26rem,var(--radix-popover-content-available-height))] dshx:items-stretch dshx:overflow-clip dshx:@max-pane-compact:h-[min(calc(72dvh-2rem),var(--radix-popover-content-available-height,100dvh))]"
              data-model-picker-surface
            >
              <section
                aria-label="Choose a model"
                className={cn(
                  'dshx:flex dshx:w-90 dshx:min-w-0 dshx:shrink-0 dshx:flex-col dshx:gap-1.5 dshx:p-1.5',
                  catalogEmpty && 'dshx:w-full',
                  // Round 4 T2: on the phone the panes start at the sheet's top, so their 44 pt header line meets Close's.
                  'dshx:@max-pane-compact:w-full dshx:@max-pane-compact:px-2 dshx:@max-pane-compact:pt-0',
                  narrowDetails && 'dshx:@max-pane-compact:hidden',
                )}
              >
                {/* Round 3 R16: on a phone the list has the same 44 pt header line as details (the title here; Close is the
                    picker's one Close at the top right). There is nothing to go back to from the list, so no Back. */}
                <header
                  className="dshx:hidden dshx:min-h-11 dshx:shrink-0 dshx:items-center dshx:pr-12 dshx:@max-pane-compact:flex"
                  data-model-picker-list-header
                >
                  <h2 className="dshx:text-heading dshx:font-semibold">Choose a model</h2>
                </header>
                <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1">
                  {/* Round 3 R18: one focus ring (the field edge does not also turn accent), a clear button inside the field,
                      and a search that waits while there is nothing to search. */}
                  <div className="dshx:relative dshx:min-w-0 dshx:flex-1">
                    <SearchInput
                      aria-activedescendant={activeIndex < 0 ? undefined : `${listboxId}-${String(activeIndex)}`}
                      aria-autocomplete="list"
                      aria-controls={listboxId}
                      aria-expanded={open}
                      aria-label="Search models and accounts"
                      autoComplete="off"
                      className="dshx:w-full dshx:has-[input:focus-visible]:border-transparent dshx:[&_input]:pr-8 dshx:pointer-coarse:[&_input]:pr-11"
                      data-model-picker-search
                      disabled={catalogEmpty}
                      onChange={event => setQuery(event.currentTarget.value)}
                      onKeyDown={event => {
                        const input = event.currentTarget
                        const action = ModelPickerModel.listKey({
                          key: event.key,
                          active: activeIndex,
                          count: rows.length,
                          caretAtEnd: input.selectionStart === input.value.length && input.selectionEnd === input.value.length,
                        })
                        if (action.kind === 'none') return
                        event.preventDefault()
                        if (action.kind === 'move') {
                          setActiveIndex(action.index)
                          setKeyboardRow(true)
                        } else if (action.kind === 'use') useRow(action.index, event.shiftKey)
                        else {
                          const row = rows[action.index]
                          if (row !== undefined) showDetails({ model: row.model.id, provider: row.group.id })
                        }
                      }}
                      role="combobox"
                      placeholder="Search models…"
                      ref={searchInputRef}
                      value={query}
                    />
                    {query === '' ? null : (
                      <button
                        aria-label="Clear search"
                        className="dshx:absolute dshx:top-1/2 dshx:right-1 dshx:flex dshx:size-6 dshx:-translate-y-1/2 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:pointer-coarse:right-0 dshx:pointer-coarse:size-11"
                        data-model-search-clear
                        onClick={() => {
                          setQuery('')
                          searchInputRef.current?.focus()
                        }}
                        type="button"
                      >
                        <XIcon aria-hidden="true" className="dshx:size-3.5" />
                      </button>
                    )}
                  </div>
                  {rows.length === 0 ? null : (
                    // Round 3 R12: a visible "Select" / "Done" label at 44 pt on touch, pressed while the mode is on.
                    <Button
                      aria-pressed={several}
                      className="dshx:h-8 dshx:shrink-0 dshx:px-2.5 dshx:pointer-coarse:h-11"
                      data-model-select-several
                      onClick={() => {
                        setSeveral(!several)
                        if (several) setFanOut([])
                      }}
                      size="sm"
                      type="button"
                      variant={several ? 'secondary' : 'ghost'}
                    >
                      {several ? t('done') : t('select')}
                    </Button>
                  )}
                </div>
                <ScrollArea
                  className="dshx:min-h-0 dshx:flex-1 dshx:data-[empty]:hidden dshx:[mask-image:linear-gradient(to_bottom,transparent,black_8px,black_calc(100%-8px),transparent)] dshx:[&_[data-slot=scroll-area-viewport]>div]:block! dshx:[&_[data-slot=scroll-area-viewport]]:[overflow-x:clip]!"
                  data-empty={emptyState === null ? undefined : ''}
                  data-model-picker-scroll
                >
                  <div
                    aria-label="Models and accounts"
                    aria-multiselectable={several || undefined}
                    // On touch the rows end clear of the list's 10 px overlay scrollbar, which took the last 4 px of each
                    // row's 44 pt details chevron (round 3 touch probe).
                    className="dshx:flex dshx:flex-col dshx:gap-px dshx:p-1 dshx:pointer-coarse:pr-3"
                    id={listboxId}
                    ref={attachModelList}
                    role="listbox"
                  >
                    {rows.map(({ key, group, model, active }, index) => (
                      <ModelRow
                        active={active}
                        busy={busy}
                        highlighted={index === activeIndex}
                        keyboard={keyboardRow}
                        inspected={inspected !== null && inspected.model === model.id}
                        id={`${listboxId}-${String(index)}`}
                        onHover={() => {
                          setActiveIndex(index)
                          setKeyboardRow(false)
                        }}
                        current={current}
                        fanOutSelected={ModelPickerModel.isFanOutRoute(fanOut, { provider: group.id, model: model.id })}
                        group={group}
                        key={key}
                        model={model}
                        onFanOut={toggleFanOut}
                        selectSeveral={several}
                        onInspect={() => showDetails({ model: model.id, provider: group.id })}
                        onSelect={choose}
                        providerLabel={providerLabels.get(group.id)}
                        accountTag={accountBadges.get(group.id) ?? ModelPickerModel.accountTag({ name: group.name })}
                        fastOn={knownFast.get(fastModeRouteKey({ sessionId: '', provider: group.id, model: model.id })) === true}
                        quota={quotas.get(group.id)}
                      />
                    ))}
                  </div>
                </ScrollArea>
                {/* Round 3 R18: the empty states take the list's room, centred, instead of a line at its top. */}
                {emptyState === null ? null : (
                  <ListEmptyState
                    kind={emptyState}
                    onClearSearch={() => {
                      setQuery('')
                      searchInputRef.current?.focus()
                    }}
                    onOpenAccounts={
                      openAccounts === undefined
                        ? undefined
                        : () => {
                            setOpen(false)
                            openAccounts()
                          }
                    }
                    query={query}
                  />
                )}
                {several ? (
                  <FanOutSelection
                    accountTagOf={fanOutTagOf}
                    className="dshx:hidden dshx:@max-pane-compact:flex"
                    groups={state.groups}
                    limit={ModelPickerModel.fanOutLimit}
                    onClear={() => setFanOut([])}
                    onFanOut={startFanOut}
                    onRemove={toggleFanOut}
                    routes={fanOut}
                    t={t}
                    variant="bar"
                  />
                ) : null}
                {state.failures.length > 0 && (
                  <p className="dshx:px-1 dshx:text-2xs dshx:text-muted-foreground">
                    {state.failures.length} provider{state.failures.length === 1 ? '' : 's'} could not load:{' '}
                    {state.failures.map(failure => failure.name).join(', ')}
                  </p>
                )}
              </section>

              <div
                className={cn(
                  'dshx:flex dshx:w-80 dshx:min-w-0 dshx:shrink-0 dshx:flex-col dshx:border-l dshx:border-border dshx:p-2.5 dshx:outline-none',
                  'dshx:@max-pane-compact:w-full dshx:@max-pane-compact:border-l-0 dshx:@max-pane-compact:px-2 dshx:@max-pane-compact:pt-0',
                  !narrowDetails && 'dshx:@max-pane-compact:hidden',
                  catalogEmpty && 'dshx:hidden',
                  several && 'dshx:@max-pane-compact:hidden',
                )}
                data-model-inspector
                onKeyDown={event => {
                  // Left returns to the list (C5), except where Left already means something: a radio group or a field.
                  if (event.key !== 'ArrowLeft' || !(event.target instanceof Element)) return
                  if (event.target.closest('[role="radiogroup"], input, textarea') !== null) return
                  event.preventDefault()
                  backToList()
                }}
                ref={detailsRef}
                tabIndex={-1}
              >
                {several ? (
                  <FanOutSelection
                    accountTagOf={fanOutTagOf}
                    groups={state.groups}
                    limit={ModelPickerModel.fanOutLimit}
                    onClear={() => setFanOut([])}
                    onFanOut={startFanOut}
                    onRemove={toggleFanOut}
                    routes={fanOut}
                    t={t}
                    variant="tray"
                  />
                ) : (
                  <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col">
                    <ModelDetails
                      accountAccents={accountAccentMap}
                      busy={busy}
                      current={current}
                      error={selectionError ?? state.error}
                      fallbacks={
                        <FallbacksSection
                          accountAccents={accountAccentMap}
                          accountBadges={accountBadges}
                          busy={busy}
                          current={current}
                          groups={state.groups}
                          providerLabels={providerLabels}
                          sessionId={sessionId}
                        />
                      }
                      fast={({ provider, model, draft }) => (
                        <FastModeSection
                          disabled={busy}
                          draft={draft}
                          key={`${sessionId}:${provider}:${model}`}
                          model={model}
                          onEnabledChange={enabled => {
                            rememberFast({ provider, model }, enabled)
                            setFastModeOverride({ enabled, routeKey: fastModeRouteKey({ model, provider, sessionId }) })
                          }}
                          onStatus={enabled => rememberFast({ provider, model }, enabled)}
                          provider={provider}
                          sessionId={sessionId}
                        />
                      )}
                      groups={state.groups}
                      inspected={inspectedRoute}
                      onBack={backToList}
                      onInspect={setInspected}
                      onRetry={load}
                      onSelect={choose}
                      onUse={(selection, fast) => void useDraft(selection, fast)}
                      providerLabels={providerLabels}
                      quotas={quotas}
                    />
                  </div>
                )}
              </div>
              {/* Round 3 R17: one Close for the whole picker, last in the DOM so it ends the Tab cycle; drawn at the top right
                  (beside the details title on desktop, the sheet header on a phone). */}
              <button
                aria-label="Close model picker"
                className="dshx:absolute dshx:top-2.5 dshx:right-2.5 dshx:flex dshx:size-5 dshx:items-center dshx:justify-center dshx:rounded dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-muted dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:pointer-coarse:size-11 dshx:@max-pane-compact:top-0 dshx:@max-pane-compact:right-0"
                data-model-picker-close
                onClick={() => setOpen(false)}
                type="button"
              >
                <XIcon aria-hidden="true" className="dshx:size-4" />
              </button>
            </div>
          </PopoverContent>
        </Popover>
        {nextAccount === undefined ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={`Switch to ${nextAccount.group.name}`}
                className="dshx:shrink-0 dshx:text-muted-foreground dshx:hover:text-foreground dshx:pointer-coarse:size-11 dshx:in-data-model-mark:hidden"
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
        {/* C5: the result count and "Switched to ‹model›" reach assistive tech without moving focus. */}
        <p aria-live="polite" className="dshx:sr-only" data-model-picker-announcer>
          {announcement}
        </p>
      </div>
    </TooltipProvider>
  )
}
