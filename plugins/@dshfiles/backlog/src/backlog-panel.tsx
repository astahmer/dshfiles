import { useWorkbenchScopeKey } from '@dshfiles/workbench/panel-occurrence'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi, usePlugin, useResource, useSettings } from '@dshfiles/dshx/client'
import { threadSidebarAttentionApi } from '@dshfiles/thread-sidebar/attention-api'
import { Page } from '@dshfiles/plugin-ui/components/page'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Kbd } from '@dshfiles/plugin-ui/components/ui/kbd'
import { BacklogSettingsSheet } from './backlog-settings-sheet.js'
import { BacklogViewSwitch, FilterMenu, ViewMenu } from './backlog-toolbar.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { useCommands } from '@dshfiles/plugin-ui/hooks/commands'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { KeyRoundIcon, ListTodoIcon, PlusIcon, SearchIcon, Settings2Icon, WandSparklesIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useAutosave } from '@dshfiles/plugin-ui/machine'
import { errorMessage, keepPreviousData, useIsMutating, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { backlogApi, BacklogViews, type BacklogBackfillResult, type BacklogSummaryView } from './api.js'
import { BackfillDialog } from './backfill-dialog.js'
import { backfillStatusQueries } from './backfill-queries.js'
import { BoardView } from './board-view.js'
import { setBacklogViewSelection, type BacklogView, type BacklogViewSelection } from './view-selection.js'
import { Composer, type ComposerThread } from './composer.js'
import { captureVisible } from './capture-visibility.js'
import type { BacklogImageEditorHandle } from './image-reference-editor.js'
import { FeedView } from './feed-view.js'
import type { BacklogSort } from './backlog-sort.js'
import { inboxThreadsFrom } from './inbox-threads.js'
import { InboxView } from './inbox-view.js'
import { BacklogItems, type BacklogKind, type BacklogStatus } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'
import { BacklogPeek } from './item-peek.js'
import { ItemsView } from './items-view.js'
import { usePrimaryModifierHeld, viewForShortcut } from './modifier-hints.js'
import { panelDraftKey } from './panel-draft.js'
import { panelPreferences } from './panel-preferences.js'
import { BacklogProjectPaths } from './project-paths.js'
import { ProjectsView } from './projects-view.js'
import { AgentRunStates } from './agent-run-state.js'
import { WorkGlyphs } from './work-glyphs.js'
import { ShippedView } from './shipped-view.js'
import { SearchResults } from './search-results.js'
import { SearchScopes, type SearchScope } from './search-scope.js'
import { backlogSettings, type BacklogSettings } from './settings.js'
import { BacklogSyncControls } from './sync-controls.js'
import { StartThreadDialog } from './start-thread-dialog.js'
import type { StartThreadAgentChoice, StartThreadCatalog, StartThreadItem, StartThreadOutcome, StartThreadProject, StartThreadRequest } from './start-thread.js'
import { FeedStatus } from './status-filter.js'
import { BACKLOG_TRIAGE_MUTATION_KEY, BacklogQueries, useBacklogActions } from './use-backlog-actions.js'
import { usePanelRequests } from './use-panel-requests.js'
import { BacklogExportSettings } from './export-settings.js'
import { BacklogHostsSettings } from './peer-settings.js'
import { withViewTransition } from './view-transition.js'
import { BacklogPanelPoll } from './panel-poll.js'
import { dispatchOpenSettings } from '@dshfiles/settings-shell/open-settings'

type OpenThread = (sessionId: string) => void
type View = BacklogView

const MAX_ANIMATED_ITEMS = 150

/** Each view, and the full search results, keeps its own "Hide agent items" choice; hiding is the default. */
type AgentItemsScope = View | 'search'

/** The panel's tooltip timing and the run-state lookup its rows, cards and inspector read. */
const PanelProviders = (props: { readonly runStateOf: Parameters<typeof WorkGlyphs.RunStateProvider>[0]['value']; readonly children: ReactNode }) => (
  <TooltipProvider delayDuration={500}>
    <WorkGlyphs.RunStateProvider value={props.runStateOf}>{props.children}</WorkGlyphs.RunStateProvider>
  </TooltipProvider>
)

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

const isVisible = (item: BacklogSummaryView, now: number): boolean =>
  (item.freshness === 'fresh' || item.freshness === 'stale') && (item.snoozedUntil ?? 0) <= now

type SavedView = BacklogSettings['savedViews'][number]

/** What the panel needs from the client entry to start a thread for an item; the entry owns those services. */
export interface StartThreadPorts {
  readonly listProjects: () => readonly StartThreadProject[]
  readonly loadCatalog: () => Promise<StartThreadCatalog>
  /** Every enabled agent, so the dialog can start the thread as one. */
  readonly listAgents: () => Promise<readonly StartThreadAgentChoice[]>
  readonly start: (request: StartThreadRequest) => Promise<StartThreadOutcome>
}

/** Opens Settings on the one shared Jev key (settings-shell's `jevSecret`, under Tools & MCP › Jev). */
const openJevKeySettings = (): void => {
  dispatchOpenSettings({ setting: { entryId: 'dshfiles-settings-shell', fieldPath: ['jevSecret'] } })
}

type JevSettingsDraft = { readonly jevEnabled: boolean; readonly autoTriage: boolean }

const BacklogSettingsPanel = (): JSX.Element => {
  const settings = useSettings(backlogSettings)
  const autosave = useAutosave<JevSettingsDraft>({
    initial: { jevEnabled: settings.value?.jevEnabled ?? false, autoTriage: settings.value?.autoTriage ?? false },
    save: async draft => {
      if (settings.status !== 'ready' || !settings.writable) throw new Error('Backlog settings are not writable right now.')
      if (!(await settings.set('jevEnabled', draft.jevEnabled))) throw new Error('Backlog could not save Jev settings.')
      if (!(await settings.set('autoTriage', draft.autoTriage))) throw new Error('Backlog could not save automatic triage settings.')
    },
  })
  const loadedJevEnabled = settings.value?.jevEnabled ?? false
  const loadedAutoTriage = settings.value?.autoTriage ?? false
  const { draft, error, send, state } = autosave
  useEffect(() => {
    if (settings.status !== 'ready') return
    send({ type: 'sync', value: { jevEnabled: loadedJevEnabled, autoTriage: loadedAutoTriage } })
  }, [loadedAutoTriage, loadedJevEnabled, send, settings.status])

  return (
    <section className="dshx-root dshx:mx-auto dshx:w-full dshx:max-w-2xl dshx:p-5 dshx:@max-pane-narrow:p-3" aria-labelledby="backlog-jev-settings-title">
      <h3 id="backlog-jev-settings-title" className="dshx:text-base dshx:font-semibold">
        Jev triage
      </h3>
      <p className="dshx:mt-1 dshx:text-sm dshx:text-muted-foreground">
        Configure the TypeSafe Jev connection used for backlog triage and reply routing. These are the same settings shown in DSH Settings.
      </p>
      <form
        className="dshx:mt-5 dshx:flex dshx:flex-col dshx:gap-4"
        onSubmit={event => {
          event.preventDefault()
          send({ type: 'flush' })
        }}
      >
        <label className="dshx:flex dshx:items-start dshx:gap-3 dshx:text-sm">
          <input
            type="checkbox"
            aria-label="Enable Jev"
            checked={draft.jevEnabled}
            disabled={!settings.writable || settings.status !== 'ready'}
            onChange={event => send({ type: 'edit', value: { ...draft, jevEnabled: event.currentTarget.checked } })}
            className="dshx:mt-0.5"
          />
          <span className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className="dshx:font-medium">Enable Jev</span>
            <span className="dshx:text-xs dshx:text-muted-foreground">Use Jev for triage, duplicate detection, and classifying backlog replies.</span>
          </span>
        </label>
        <label className="dshx:flex dshx:items-start dshx:gap-3 dshx:text-sm">
          <input
            type="checkbox"
            aria-label="Triage new items automatically"
            checked={draft.autoTriage}
            disabled={!settings.writable || settings.status !== 'ready'}
            onChange={event => send({ type: 'edit', value: { ...draft, autoTriage: event.currentTarget.checked } })}
            className="dshx:mt-0.5"
          />
          <span className="dshx:flex dshx:flex-col dshx:gap-1">
            <span className="dshx:font-medium">Triage new items automatically</span>
            <span className="dshx:text-xs dshx:text-muted-foreground">Run configured triage in the background when an item is captured.</span>
          </span>
        </label>
        <div className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:text-sm">
          <span className="dshx:font-medium">TypeSafe API key</span>
          <span className="dshx:text-xs dshx:text-muted-foreground">
            One key serves Backlog triage and Memory. Set it in Settings › Tools & MCP › Jev. Without it, DSH uses TYPESAFE_API_KEY from its environment.
          </span>
          <Button type="button" variant="outline" size="sm" className="dshx:self-start" onClick={openJevKeySettings}>
            <KeyRoundIcon aria-hidden /> Open Jev settings
          </Button>
        </div>
        {error === null ? null : (
          <p className="dshx:text-sm dshx:text-destructive" role="alert">
            {errorMessage(error, 'Could not save Jev settings.')}
          </p>
        )}
        {state === 'saved' ? (
          <p className="dshx:text-sm dshx:text-success" role="status">
            Jev settings saved.
          </p>
        ) : null}
        <div>
          <Button type="submit" size="sm" disabled={!settings.writable || settings.status !== 'ready' || settings.mutation.pending}>
            Save Jev settings
          </Button>
        </div>
      </form>
      {!settings.writable ? <p className="dshx:mt-3 dshx:text-xs dshx:text-muted-foreground">Backlog settings are currently read-only.</p> : null}
    </section>
  )
}

export const BacklogPanel = (props: {
  readonly panelId?: string | undefined
  readonly visible?: boolean | undefined
  readonly openThread: OpenThread
  /** Opens the one Inbox; every count of what needs the user lives there, not on this panel. */
  readonly openInbox?: (() => void) | undefined
  readonly listThreads: () => readonly ComposerThread[]
  readonly startThread: StartThreadPorts
  readonly agentForThread: (sessionId: string) => Promise<{ readonly name: string } | null>
}): JSX.Element => {
  const draftKey = panelDraftKey(props.panelId)
  const api = useApi(backlogApi)
  const actions = useBacklogActions()
  const triagePending = useIsMutating({ mutationKey: BACKLOG_TRIAGE_MUTATION_KEY }) > 0
  const [backfillStarted, setBackfillStarted] = useState<BacklogBackfillResult | null>(null)
  const [backfillStartError, setBackfillStartError] = useState<string | null>(null)
  const backfillJobId = backfillStarted?.jobId ?? null
  const backfill = useQuery(backfillStatusQueries.status({ client: api, jobId: backfillJobId }))
  // The run's own answer stands in until the first poll lands, and covers a Host that reports no job id at all.
  const backfillJob = backfill.data === undefined ? backfillStarted : backfill.data
  const backfillJobState = backfillJob?.state
  const backfillError =
    backfillStartError ??
    (backfill.error === null ? null : errorMessage(backfill.error, 'Could not read backfill progress. Reopen Backlog to check again.')) ??
    (backfillJobId !== null && backfill.isSuccess && backfill.data === null ? 'This backfill ended when DSH restarted. Start it again.' : null)
  const scopeKey = useWorkbenchScopeKey()
  const preferences = useMemo(() => panelPreferences(props.panelId, scopeKey), [props.panelId, scopeKey])
  const stored = preferences.useValue()
  const view = stored.view
  const setPreference = (change: Partial<typeof stored>): void => {
    preferences.set({ ...preferences.get(), ...change })
  }
  const [search, setSearch] = useState<SearchScope>(SearchScopes.idle)
  const query = search.query
  const [kinds, setKinds] = useState<BacklogKind[]>([])
  const [openIds, setOpenIds] = useState<BacklogViewSelection>({
    feed: null,
    inbox: null,
    ready: null,
    items: null,
    board: null,
    projects: null,
    shipped: null,
  })
  const [cursorIds, setCursorIds] = useState<BacklogViewSelection>({
    feed: null,
    inbox: null,
    ready: null,
    items: null,
    board: null,
    projects: null,
    shipped: null,
  })
  const openId = openIds[view]
  const cursorId = cursorIds[view]
  const setOpenId = useCallback((id: number | null): void => setOpenIds(selection => setBacklogViewSelection(selection, view, id)), [view])
  const setCursorId = useCallback((id: number | null): void => setCursorIds(selection => setBacklogViewSelection(selection, view, id)), [view])
  const [expanded, setExpanded] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set(['dropped']))
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [captureStatus, setCaptureStatus] = useState<BacklogStatus | null>(null)
  const [captureRequest, setCaptureRequest] = useState<{ readonly id: number; readonly text: string } | undefined>()
  const [captureRequested, setCaptureRequested] = useState(false)
  const [startThreadItems, setStartThreadItems] = useState<readonly StartThreadItem[] | null>(null)
  const [backfillOpen, setBackfillOpen] = useState(false)
  const openStartThread = (items: readonly StartThreadItem[]): void => setStartThreadItems(items)
  const captureComposer = useRef<BacklogImageEditorHandle | null>(null)
  const panelRoot = useRef<HTMLElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const debounced = useDebouncedValue({ value: query, delayMs: 120 })
  const showsResults = SearchScopes.showsResults({ query: debounced, submitted: search.submitted })
  /** The feed with no item open draws only its rows: the card hugs them (round five P6). */
  const hugsContent = view === 'feed' && !showsResults && openId === null
  const agentItemsScope: AgentItemsScope = showsResults ? 'search' : view
  const hideAgentItems = stored.hideAgentItems[agentItemsScope]

  const queryClient = useQueryClient()
  const visible = props.visible !== false
  // A cheap number that changes with any write; lists and details refetch only when it moves.
  const revision = useResource(backlogApi, 'revision', undefined, { ...BacklogPanelPoll.revision, visible })
  const aiActivity = useResource(backlogApi, 'aiActivity', undefined, { ...BacklogPanelPoll.aiActivity, visible })
  const aiWorking =
    triagePending || (aiActivity.status !== 'error' && aiActivity.data?.active === true) || backfillJobState === 'queued' || backfillJobState === 'running'
  const lastRevision = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (revision.data === undefined) return
    if (lastRevision.current !== undefined && lastRevision.current !== revision.data) void queryClient.invalidateQueries({ queryKey: [BacklogQueries.key] })
    lastRevision.current = revision.data
  }, [revision.data, queryClient])
  usePanelRequests({
    visible,
    onCapture: request => {
      setCaptureRequested(true)
      setCaptureRequest(request)
    },
    onFocus: key => {
      const select = (itemId: number): void => {
        setOpenId(itemId)
        setCursorId(itemId)
        setExpanded(false)
      }
      if (typeof key === 'number') return select(key)
      const selectByRef = async (): Promise<void> => {
        const result = await api.get({ id: key })
        if (result.ok) select(result.value.item.id)
      }
      void selectByRef().catch(() => undefined)
    },
  })
  const projectFilters: (string | null)[] =
    stored.projects.length > 0
      ? stored.projects.map(project => (project === '' ? null : project))
      : stored.project === null
        ? []
        : [stored.project === '' ? null : stored.project]
  // `undefined` is not a JSON value, so an unfiltered list omits the key instead of carrying the scope along.
  const scoped = projectFilters.length === 0 ? {} : { projects: projectFilters }
  const list = useQuery({
    queryKey: [BacklogQueries.key, 'list', debounced, kinds, projectFilters, showsResults ? stored.statuses : [], hideAgentItems],
    queryFn: async ({ signal }) => {
      const statusFilter = showsResults && stored.statuses.length > 0 ? { statuses: stored.statuses } : {}
      const input: Parameters<typeof api.list>[0] = {
        query: debounced,
        kinds,
        ...scoped,
        ...statusFilter,
        freshness: 'all',
        limit: showsResults ? 200 : 2_000,
      }
      return BacklogViews.list(await api.list(BacklogViews.hidingAgentItems(input, hideAgentItems), { signal }))
    },
    placeholderData: keepPreviousData,
  })
  const searchStatusCounts = useQuery({
    queryKey: [BacklogQueries.key, 'search-status-counts', debounced, kinds, projectFilters, stored.hideAgentItems.search],
    queryFn: async ({ signal }) => {
      const counts = await Promise.all(
        BacklogItems.statuses.map(async status => {
          const result = await api.list(
            BacklogViews.hidingAgentItems({ query: debounced, kinds, statuses: [status], ...scoped, freshness: 'all', limit: 1 }, stored.hideAgentItems.search),
            { signal },
          )
          return [status, BacklogViews.list(result).total] as const
        }),
      )
      const totals = { inbox: 0, todo: 0, doing: 0, done: 0, dropped: 0 } satisfies Record<BacklogStatus, number>
      for (const [status, count] of counts) totals[status] = count
      return totals
    },
    enabled: showsResults,
  })
  const inbox = useQuery({
    queryKey: [BacklogQueries.key, 'list', 'inbox', projectFilters, debounced, stored.hideAgentItems.inbox],
    queryFn: async ({ signal }) =>
      BacklogViews.list(
        await api.list(BacklogViews.hidingAgentItems({ inbox: true, query: debounced, ...scoped, freshness: 'all', limit: 200 }, stored.hideAgentItems.inbox), {
          signal,
        }),
      ),
    placeholderData: keepPreviousData,
  })
  const projectCatalog = useQuery({
    queryKey: [BacklogQueries.key, 'projects'],
    queryFn: ({ signal }) => api.projects(undefined, { signal }),
  })
  const settings = useSettings(backlogSettings)
  // Settings writes round-trip through the Host for a few seconds; show the saved list at once and defer to it after.
  const [pendingViews, setPendingViews] = useState<SavedView[] | null>(null)
  const storedViews = settings.value?.savedViews
  useEffect(() => {
    setPendingViews(null)
  }, [storedViews])
  const savedViews = pendingViews ?? storedViews ?? []
  const inboxThreadsMode = settings.value?.inboxThreads ?? 'failures'
  const triageOff = settings.value !== undefined && !settings.value.jevEnabled && (settings.value.triageProvider === '' || settings.value.triageModel === '')
  const attentionApi = useApi(threadSidebarAttentionApi)
  const attention = useQuery({
    queryKey: [BacklogQueries.key, 'thread-attention'],
    queryFn: async ({ signal }) => (await attentionApi.state(undefined, { signal })).sessions,
    refetchInterval: query => (isApiOwnerMissing(query.state.error) ? false : 10_000),
    retry: false,
  })
  const attentionOwnerMissing = isApiOwnerMissing(attention.error)
  const now = list.dataUpdatedAt
  const all = useMemo(() => list.data?.items ?? [], [list.data])
  const items = useMemo(
    () => (stored.showDormant || showsResults ? all : all.filter(item => isVisible(item, now))),
    [all, stored.showDormant, showsResults, now],
  )
  const filteredItems = useMemo(() => FeedStatus.filter(items, stored.statuses), [items, stored.statuses])
  // Readiness is the Host's call over the whole store, so a dormant item that is ready still shows.
  const readyAll = useMemo(() => all.filter(item => item.ready), [all])
  const readyItems = useMemo(() => FeedStatus.filter(readyAll, stored.statuses), [readyAll, stored.statuses])
  const readyTotals = useMemo(() => FeedStatus.counts(readyAll), [readyAll])
  const statusTotals = useMemo(() => FeedStatus.counts(items), [items])
  const inboxItems = inbox.data?.items ?? []
  const inboxThreads = useMemo(
    () =>
      inboxThreadsFrom({
        mode: inboxThreadsMode,
        records: attentionOwnerMissing ? [] : (attention.data ?? []),
        items: all,
        titles: new Map(props.listThreads().map(thread => [thread.id, thread.title])),
      }),
    [attention.data, attentionOwnerMissing, all, inboxThreadsMode, props],
  )
  const tags = useMemo(() => [...new Set(all.flatMap(item => item.tags))].sort(), [all])
  const threads = props.listThreads()
  const runStateOf = useMemo(() => {
    const byId = new Map(threads.map(thread => [thread.id, thread]))
    const finished = new Map((attentionOwnerMissing ? [] : (attention.data ?? [])).map(record => [record.sessionId, record.finishedReason]))
    return (item: Pick<BacklogSummaryView, 'status' | 'delegate' | 'links'>) => AgentRunStates.of({ item, threads: byId, finished, now })
  }, [threads, attention.data, attentionOwnerMissing, now])
  const projectPaths = useMemo(() => {
    const backlogProjects = (projectCatalog.data ?? []).flatMap(project => (project.project === null ? [] : [project.project]))
    const workspaceProjects = props.startThread.listProjects().map(project => project.path)
    return [...BacklogProjectPaths.candidates([backlogProjects, workspaceProjects])].sort((left, right) =>
      ItemGlyphs.projectName(left).localeCompare(ItemGlyphs.projectName(right)),
    )
  }, [projectCatalog.data, props.startThread])

  const select = (id: number): void => {
    setOpenId(id)
    setCursorId(id)
    if (view === 'inbox') void api.acknowledge({ ids: [id] }).then(() => inbox.refetch())
  }
  const switchView = (next: View): void => {
    // Switching views cross-fades the two layouts; item names stay per-view so no row stretches into a card. The
    // browser snapshots every named element, so a large backlog switches instantly instead.
    if (items.length <= MAX_ANIMATED_ITEMS) withViewTransition(() => setPreference({ view: next }))
    else setPreference({ view: next })
    setSearch(SearchScopes.leaveResults)
    setExpanded(false)
    setCaptureRequested(false)
  }
  const startCapture = (status: BacklogStatus | null): void => {
    setCaptureStatus(status)
    setCaptureRequested(true)
    requestAnimationFrame(() => captureComposer.current?.focus())
  }

  const sort: BacklogSort = view === 'feed' || view === 'inbox' || view === 'items' ? stored.sort[view] : 'updated'
  const moveCursor = (step: number): void => {
    const rendered = Array.from(panelRoot.current?.querySelectorAll<HTMLElement>('[data-backlog-item-id]') ?? []).filter(
      element => element.getClientRects().length > 0 && element.closest('aside, [role="dialog"]') === null,
    )
    const visibleIds = [...new Set(rendered.map(element => Number(element.dataset.backlogItemId)))]
    const index = visibleIds.indexOf(cursorId ?? openId ?? -1)
    const next = visibleIds[Math.min(visibleIds.length - 1, Math.max(0, index === -1 ? 0 : index + step))]
    if (next === undefined) return
    setCursorId(next)
    rendered.find(element => Number(element.dataset.backlogItemId) === next)?.scrollIntoView({ block: 'nearest' })
    if (openId !== null || view === 'inbox') select(next)
  }

  const navigateToNearestItem = (): boolean => {
    const root = panelRoot.current
    const composer = captureComposer.current?.element()
    if (root === null || composer === null || composer === undefined) return false
    const composerTop = composer.getBoundingClientRect().top
    const nearest = Array.from(root.querySelectorAll<HTMLElement>('[data-backlog-item-id]'))
      .map(element => {
        const bounds = element.getBoundingClientRect()
        return { element, id: Number(element.dataset.backlogItemId), bounds }
      })
      .filter(candidate => Number.isSafeInteger(candidate.id) && candidate.bounds.height > 0 && candidate.bounds.bottom <= composerTop)
      .sort((left, right) => right.bounds.bottom - left.bounds.bottom)
      .at(0)
    if (nearest === undefined) return false
    const focusTarget = nearest.element.matches('button, a[href], input, select, textarea, [tabindex]')
      ? nearest.element
      : nearest.element.querySelector<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')
    if (focusTarget === null) return false
    setCursorId(nearest.id)
    focusTarget.focus({ preventScroll: true })
    return true
  }

  // J and K go through the shortcut layer (@dshfiles/shortcuts), which already refuses them while typing, in an IME
  // composition or with single-key shortcuts off, and lists them in the ? sheet; the arrows stay native to the list.
  useCommands(usePlugin(), [
    {
      id: '@dshfiles/backlog.next',
      title: 'Next item',
      keys: ['J'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: () => panelRoot.current,
      run: () => moveCursor(1),
    },
    {
      id: '@dshfiles/backlog.previous',
      title: 'Previous item',
      keys: ['K'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: () => panelRoot.current,
      run: () => moveCursor(-1),
    },
  ])

  const modifierHeld = usePrimaryModifierHeld()

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (isTyping(event.target) || event.altKey) return
    const modified = event.metaKey || event.ctrlKey
    if (modified) {
      const shortcutView = viewForShortcut(event.key)
      if (shortcutView === undefined) return
      event.preventDefault()
      switchView(shortcutView)
      return
    }
    if (event.target instanceof HTMLElement && event.target.closest('[role="menu"], [role="dialog"]') !== null) return
    if (event.key === 'Enter' && event.target instanceof HTMLElement && event.target.closest('button, a[href]') !== null) return
    const viewKey = viewForShortcut(event.key)
    if (viewKey !== undefined) switchView(viewKey)
    else if (event.key === 'ArrowDown') moveCursor(1)
    else if (event.key === 'ArrowUp') moveCursor(-1)
    else if (event.key === 'Enter' && cursorId !== null) select(cursorId)
    else if (event.key === 'Escape' && expanded) setExpanded(false)
    else if (event.key === 'Escape' && openId !== null) setOpenId(null)
    else if (event.key === 'c') startCapture(captureStatus)
    else if (event.key === '/') searchInput.current?.focus()
    else return
    event.preventDefault()
  }

  const openSummary = all.find(item => item.id === openId) ?? inboxItems.find(item => item.id === openId)
  const inspector =
    openId === null ? null : (
      <BacklogPeek.Panel
        key={openId}
        panelRoot={panelRoot}
        id={openId}
        triageOff={triageOff}
        threads={threads}
        summary={openSummary}
        expanded={expanded}
        embedded={view === 'inbox'}
        toggleExpanded={() => withViewTransition(() => setExpanded(!expanded))}
        openThread={props.openThread}
        agentForThread={props.agentForThread}
        select={select}
        projectPaths={projectPaths}
        startThread={openStartThread}
        openCreatedByDefault={settings.value?.startThreadOpensCreated ?? false}
        smartThreadRouting={settings.value?.smartThreadRouting ?? true}
        smartReplyAnswers={settings.value?.smartReplyAnswers ?? true}
        threadStartNotifications={settings.value?.threadStartNotifications ?? 'in-app'}
        close={() => {
          setOpenId(null)
          setExpanded(false)
        }}
      />
    )

  return (
    <PanelProviders runStateOf={runStateOf}>
      <main
        ref={panelRoot}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-shortcut-scope="list"
        data-backlog-panel=""
        className="dshx-root dshx:relative dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:bg-background dshx:text-foreground dshx:outline-none"
      >
        <Page
          fill
          // A list page in the kit's lane (880 px of content, 960 px on a pane of 1280 px or more); the board's columns take the
          // full width (council round 3, D2).
          width={view === 'board' ? 'full' : 'lane'}
          // The Work destination's glyph in its tone before the h1 (council round 7, D1).
          mark={<ListTodoIcon />}
          markTone="work"
          heading="Backlog"
          {...(list.data === undefined ? {} : { count: list.data.total })}
          description="Tasks, bugs, ideas and notes you and your agents capture."
          meta={
            <>
              {aiWorking ? <Spinner aria-label="AI is working" className="dshx:size-3.5 dshx:text-muted-foreground" /> : null}
              {backfillJob !== null && !backfillOpen && (backfillJob.state === 'queued' || backfillJob.state === 'running') ? (
                <Button type="button" variant="ghost" size="xs" className="dshx:text-muted-foreground" onClick={() => setBackfillOpen(true)}>
                  Backfill {backfillJob.completed}/{backfillJob.total}
                </Button>
              ) : null}
            </>
          }
          primaryAction={{ id: 'new', label: 'New', icon: <PlusIcon aria-hidden />, onSelect: () => startCapture(null) }}
          actions={[
            { id: 'settings', label: 'Settings', icon: <Settings2Icon aria-hidden />, onSelect: () => setSettingsOpen(true), placement: 'overflow' },
            { id: 'backfill', label: 'Backfill triage', icon: <WandSparklesIcon aria-hidden />, onSelect: () => setBackfillOpen(true), placement: 'overflow' },
          ]}
          overflowLabel="More backlog actions"
          className="dshx:min-h-0 dshx:flex-1"
          bodyClassName="dshx:gap-3"
        >
          {/* The view tabs' bottom rule: 36 px, the tabs' underline sits on it; the search and menus share the row. */}
          <div
            className="dshx:flex dshx:h-9 dshx:min-w-0 dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:@max-pane-narrow:h-auto dshx:@max-pane-narrow:flex-wrap dshx:@max-pane-narrow:border-b-0"
          >
            <BacklogViewSwitch view={view} onSelect={switchView} modifierHeld={modifierHeld} />
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="dshx:ml-auto dshx:flex dshx:h-7 dshx:min-w-28 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-field-border dshx:bg-background dshx:px-2 dshx:text-muted-foreground dshx:transition-colors dshx:focus-within:border-ring dshx:focus-within:ring-[3px] dshx:focus-within:ring-ring/50 dshx:@max-pane-narrow:order-last dshx:@max-pane-narrow:ml-0 dshx:@max-pane-narrow:h-touch dshx:@max-pane-narrow:basis-full">
                  <SearchIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
                  <input
                    ref={searchInput}
                    aria-label="Search backlog"
                    placeholder="Search items, tags, links…"
                    value={query}
                    onChange={event => {
                      const next = event.currentTarget.value
                      setSearch(scope => SearchScopes.type(scope, next))
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        setSearch(SearchScopes.submit)
                        return
                      }
                      if (event.key !== 'Escape') return
                      setSearch(SearchScopes.idle)
                      event.currentTarget.blur()
                    }}
                    className="dshx:w-44 dshx:min-w-0 dshx:flex-1 dshx:bg-transparent dshx:text-xs dshx:text-foreground dshx:outline-none dshx:placeholder:text-muted-foreground"
                  />
                  {query === '' ? (
                    <Kbd className="dshx:@max-pane-narrow:hidden">/</Kbd>
                  ) : search.submitted ? null : (
                    <Kbd className="dshx:@max-pane-narrow:hidden">↵</Kbd>
                  )}
                </label>
              </TooltipTrigger>
              <TooltipContent>Filters this view; press Enter for all results</TooltipContent>
            </Tooltip>
            <ViewMenu
              projects={projectFilters}
              projectPaths={projectPaths}
              setProjects={projects => setPreference({ projects: [...projects], project: null })}
              sort={
                view === 'feed' || view === 'inbox' || view === 'items'
                  ? { value: sort, allowsPriority: view === 'items', set: next => setPreference({ sort: { ...stored.sort, [view]: next } }) }
                  : undefined
              }
              agentItems={
                view === 'shipped' && !showsResults
                  ? undefined
                  : {
                      hidden: hideAgentItems,
                      hiddenCount: (view === 'inbox' && !showsResults ? inbox.data : list.data)?.hiddenAgentItems ?? 0,
                      toggle: () => setPreference({ hideAgentItems: { ...stored.hideAgentItems, [agentItemsScope]: !hideAgentItems } }),
                    }
              }
              savedViews={{
                views: savedViews,
                query,
                view,
                writable: settings.writable,
                save: views => {
                  setPendingViews(views)
                  void settings.set('savedViews', views).catch(() => setPendingViews(null))
                },
                apply: saved => {
                  switchView(saved.view)
                  setSearch(scope => SearchScopes.type(SearchScopes.leaveResults(scope), saved.query))
                },
              }}
            />
            {view === 'shipped' && !showsResults ? null : (
              <FilterMenu
                kinds={kinds}
                setKinds={setKinds}
                showDormant={stored.showDormant}
                setShowDormant={value => setPreference({ showDormant: value })}
                // The Feed has no status row of its own: its status filter is the first group of this menu (council round 2, D2).
                status={
                  view === 'feed' && !showsResults
                    ? {
                        counts: statusTotals,
                        statuses: stored.statuses,
                        toggle: status => setPreference({ statuses: FeedStatus.toggle(stored.statuses, status) }),
                        clear: () => setPreference({ statuses: [] }),
                      }
                    : undefined
                }
              />
            )}
          </div>
          {list.isError ? (
            <p role="alert" className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:px-4 dshx:py-2 dshx:text-xs dshx:text-destructive">
              <span className="dshx:min-w-0">{errorMessage(list.error, 'The backlog is unavailable.')}</span>
              <Button size="xs" variant="outline" onClick={() => void list.refetch()}>
                Retry
              </Button>
            </p>
          ) : null}
          <div
            data-backlog-content-region
            className={cn(
              'dshx:relative dshx:flex dshx:min-h-0 dshx:flex-1 dshx:overflow-clip dshx:rounded-lg dshx:border dshx:border-border dshx:@max-pane-compact:flex-col',
              // The feed card ends at its last row with the capture box under it, instead of an empty card to the page foot.
              hugsContent && 'dshx:flex-initial',
            )}
          >
            {showsResults ? (
              <>
                <div className={cn('dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col', expanded && openId !== null && 'dshx:hidden')}>
                  <SearchResults
                    items={all}
                    total={list.data?.total ?? 0}
                    counts={searchStatusCounts.data ?? FeedStatus.counts(all)}
                    statuses={stored.statuses}
                    toggleStatus={status => setPreference({ statuses: FeedStatus.toggle(stored.statuses, status) })}
                    clearStatuses={() => setPreference({ statuses: [] })}
                    query={debounced}
                    triageOff={triageOff}
                    openId={openId}
                    cursorId={cursorId}
                    select={select}
                    hover={setCursorId}
                    loaded={list.isSuccess}
                    startThread={openStartThread}
                    projectPaths={projectPaths}
                  />
                </div>
                {inspector}
              </>
            ) : view === 'inbox' ? (
              <InboxView
                triageOff={triageOff}
                items={inboxItems}
                cursorId={cursorId}
                threads={inboxThreads}
                openId={openId}
                select={select}
                openThread={props.openThread}
                threadTitle={sessionId => threads.find(thread => thread.id === sessionId)?.title}
                openInbox={props.openInbox}
                acknowledgeThread={thread =>
                  void attentionApi.safe.acknowledge({ sessionId: thread.sessionId, version: thread.version }).then(() => attention.refetch())
                }
                inspector={inspector}
                loaded={inbox.isSuccess}
                sort={stored.sort.inbox}
                startThread={openStartThread}
                projectPaths={projectPaths}
              />
            ) : (
              <>
                <div className={cn('dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col', expanded && openId !== null && 'dshx:hidden')}>
                  {view === 'feed' && (
                    <FeedView
                      cursorId={cursorId}
                      triageOff={triageOff}
                      items={filteredItems}
                      sort={stored.sort.feed}
                      statuses={stored.statuses}
                      clearStatuses={() => setPreference({ statuses: [] })}
                      openId={openId}
                      select={select}
                      loaded={list.isSuccess}
                      now={now}
                      projectPaths={projectPaths}
                      startThread={openStartThread}
                      openThread={props.openThread}
                    />
                  )}
                  {view === 'ready' && (
                    <ItemsView
                      ready
                      items={readyItems}
                      sort="priority"
                      counts={readyTotals}
                      statuses={stored.statuses}
                      toggleStatus={status => setPreference({ statuses: FeedStatus.toggle(stored.statuses, status) })}
                      clearStatuses={() => setPreference({ statuses: [] })}
                      openId={openId}
                      cursorId={cursorId}
                      select={select}
                      hover={setCursorId}
                      groupBy="priority"
                      triageOff={triageOff}
                      setGroupBy={() => undefined}
                      collapsed={collapsed}
                      setCollapsed={next => withViewTransition(() => setCollapsed(next))}
                      captureInto={startCapture}
                      projectPaths={projectPaths}
                      startThread={openStartThread}
                    />
                  )}
                  {view === 'items' && (
                    <ItemsView
                      items={filteredItems}
                      sort={stored.sort.items}
                      counts={statusTotals}
                      statuses={stored.statuses}
                      toggleStatus={status => setPreference({ statuses: FeedStatus.toggle(stored.statuses, status) })}
                      clearStatuses={() => setPreference({ statuses: [] })}
                      openId={openId}
                      cursorId={cursorId}
                      select={select}
                      hover={setCursorId}
                      groupBy={stored.groupBy}
                      triageOff={triageOff}
                      setGroupBy={groupBy => withViewTransition(() => setPreference({ groupBy }))}
                      collapsed={collapsed}
                      setCollapsed={next => withViewTransition(() => setCollapsed(next))}
                      captureInto={startCapture}
                      projectPaths={projectPaths}
                      startThread={openStartThread}
                    />
                  )}
                  {view === 'board' && (
                    <BoardView
                      panelId={props.panelId}
                      triageOff={triageOff}
                      items={items}
                      openId={openId}
                      cursorId={cursorId}
                      open={select}
                      captureInto={startCapture}
                      projectPaths={projectPaths}
                      startThread={openStartThread}
                    />
                  )}
                  {view === 'shipped' && (
                    <ShippedView
                      period={stored.shippedPeriod}
                      setPeriod={shippedPeriod => setPreference({ shippedPeriod })}
                      projects={projectFilters}
                      openId={openId}
                      cursorId={cursorId}
                      select={select}
                      hover={setCursorId}
                      openSettings={() => setSettingsOpen(true)}
                    />
                  )}
                  {view === 'projects' && (
                    <ProjectsView
                      query={debounced}
                      hideAgentItems={hideAgentItems}
                      matchingProjects={
                        debounced === ''
                          ? projectFilters.length === 0
                            ? null
                            : new Set(projectFilters.map(project => project ?? ''))
                          : SearchScopes.matchingProjects(items)
                      }
                      triageOff={triageOff}
                      selectedProject={selectedProject}
                      setSelectedProject={setSelectedProject}
                      select={select}
                      now={now}
                      startThread={openStartThread}
                      projectPaths={projectPaths}
                    />
                  )}
                </div>
                {inspector}
              </>
            )}
          </div>
          {captureVisible({ view, requested: captureRequested }) ? (
            <div className="dshx:shrink-0">
              <div>
                <Composer
                  key={draftKey}
                  variant="chat"
                  draftKey={draftKey}
                  placeholder="Capture a task, bug or idea…"
                  tags={tags}
                  threads={threads}
                  projects={projectPaths}
                  projectFilter={projectFilters.length === 0 ? null : projectFilters.length === 1 ? (projectFilters[0] ?? null) : null}
                  reuseProject={settings.value?.reuseCaptureProject ?? true}
                  templates={(settings.value?.templates ?? []).map(entry => entry.name)}
                  status={captureStatus}
                  onClearStatus={() => setCaptureStatus(null)}
                  inputRef={captureComposer}
                  onNavigateUp={navigateToNearestItem}
                  {...(view === 'feed' ? {} : { onDismiss: () => setCaptureRequested(false) })}
                  {...(captureRequest === undefined ? {} : { captureRequest })}
                />
              </div>
            </div>
          ) : null}
        </Page>
        <BacklogSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen}>
          <BacklogSettingsPanel />
          <BacklogSyncControls.Settings projectPaths={projectPaths} />
          <BacklogHostsSettings />
          <BacklogExportSettings />
        </BacklogSettingsSheet>
        {startThreadItems === null ? null : (
          <StartThreadDialog
            key={startThreadItems.map(item => item.id).join('-')}
            items={startThreadItems}
            projects={props.startThread.listProjects()}
            loadCatalog={props.startThread.loadCatalog}
            listAgents={props.startThread.listAgents}
            openByDefault={settings.value?.startThreadOpensCreated ?? false}
            start={request => {
              // Creating the thread runs on in the background; the entry reports it in a toast wherever the user went.
              void props.startThread.start(request)
            }}
            close={() => setStartThreadItems(null)}
          />
        )}
        <BackfillDialog
          open={backfillOpen}
          triageOff={triageOff}
          progress={backfillJob}
          error={backfillError}
          onError={message => setBackfillStartError(message.length === 0 ? null : message)}
          run={async request => {
            setBackfillStartError(null)
            setBackfillStarted(null)
            const started = await actions.backfillTriage.mutateAsync(request)
            if (started.jobId !== null) queryClient.setQueryData(backfillStatusQueries.key(started.jobId), started)
            setBackfillStarted(started)
            void queryClient.invalidateQueries({ queryKey: [BacklogQueries.key] })
          }}
          close={() => setBackfillOpen(false)}
        />
      </main>
    </PanelProviders>
  )
}
