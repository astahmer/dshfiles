import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi, useSettings } from '@dshfiles/dshx/client'
import { threadSidebarAttentionApi } from '@dshfiles/thread-sidebar/attention-api'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Kbd } from '@dshfiles/plugin-ui/components/ui/kbd'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import {
  ArrowDownWideNarrowIcon,
  BookmarkIcon,
  FolderIcon,
  FolderKanbanIcon,
  XIcon,
  InboxIcon,
  KanbanIcon,
  ListFilterIcon,
  MessagesSquareIcon,
  PlusIcon,
  Rows3Icon,
  SearchIcon,
  WandSparklesIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, keepPreviousData, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { z } from 'zod'

import { backlogApi, BacklogViews, type BacklogBackfillResult, type BacklogSummaryView } from './api.js'
import { BackfillDialog } from './backfill-dialog.js'
import { BoardView } from './board-view.js'
import { BacklogFocusModel } from './backlog-focus.js'
import { setBacklogViewSelection, type BacklogView, type BacklogViewSelection } from './view-selection.js'
import { Composer, type ComposerThread } from './composer.js'
import { FeedView } from './feed-view.js'
import { sortBacklogItems, type BacklogSort } from './backlog-sort.js'
import { inboxThreadsFrom } from './inbox-threads.js'
import { InboxView, inboxOrder } from './inbox-view.js'
import { BacklogItems, type BacklogKind, type BacklogStatus } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'
import { BacklogPeek } from './item-peek.js'
import { ItemsView, itemsOrder } from './items-view.js'
import { BacklogProjectPaths } from './project-paths.js'
import { ProjectsView } from './projects-view.js'
import { BacklogProjects, ProjectFilterPicker, ProjectPicker } from './project-picker.js'
import { SearchResults } from './search-results.js'
import { backlogSettings, type BacklogSettings } from './settings.js'
import { StartThreadDialog } from './start-thread-dialog.js'
import type { StartThreadAgentChoice, StartThreadCatalog, StartThreadItem, StartThreadOutcome, StartThreadProject, StartThreadRequest } from './start-thread.js'
import { FeedStatus } from './status-filter.js'
import { BacklogQueries, useBacklogActions } from './use-backlog-actions.js'
import { withViewTransition } from './view-transition.js'

type OpenThread = (sessionId: string) => void
type View = BacklogView

/** Agents write from other threads; a short poll keeps the open panel current without a push channel. */
const REFRESH_MS = 5_000
const MAX_ANIMATED_ITEMS = 150
const views = ['feed', 'inbox', 'items', 'board', 'projects'] as const
const viewLabels = { feed: 'Feed', inbox: 'Inbox', items: 'Items', board: 'Board', projects: 'Projects' } satisfies Record<View, string>
const viewIcons = { feed: MessagesSquareIcon, inbox: InboxIcon, items: Rows3Icon, board: KanbanIcon, projects: FolderKanbanIcon } as const

const preferences = createStoredValue({
  key: 'dshfiles.backlog.view.v2',
  schema: z.object({
    view: z.enum(views),
    groupBy: z.enum(['status', 'kind', 'project', 'attention']),
    showDormant: z.boolean(),
    statuses: z.array(BacklogItems.statusSchema).default([]),
    project: z.string().nullable().default(null),
    projects: z.array(z.string().nullable()).default([]),
    sort: z
      .object({
        feed: z.enum(['updated', 'created']).default('updated'),
        inbox: z.enum(['updated', 'created']).default('updated'),
        items: z.enum(['updated', 'created']).default('updated'),
      })
      .default({ feed: 'updated', inbox: 'updated', items: 'updated' }),
  }),
  fallback: {
    view: 'feed' as const,
    groupBy: 'status' as const,
    showDormant: false,
    statuses: [],
    project: null,
    projects: [],
    sort: { feed: 'updated' as const, inbox: 'updated' as const, items: 'updated' as const },
  },
})

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

const isVisible = (item: BacklogSummaryView, now: number): boolean =>
  (item.freshness === 'fresh' || item.freshness === 'stale') && (item.snoozedUntil ?? 0) <= now

/** The header's searchable multi-select narrows every backlog view to any chosen projects. */
const ProjectFilter = (props: {
  readonly projects: readonly (string | null)[]
  readonly projectPaths: readonly string[]
  readonly onPick: (projects: readonly (string | null)[]) => void
}): JSX.Element => {
  const count = props.projects.length
  const labels = props.projects.flatMap(project => (project === null ? ['No project'] : [ItemGlyphs.projectName(project)]))
  const label = count === 0 ? 'All projects' : count === 1 ? (labels[0] ?? '1 project') : `${count} projects`
  const pathTitle = props.projects.flatMap(project => (project === null ? [] : [ItemGlyphs.displayProjectPath(project)])).join(', ')
  const singleProject = count === 1 && typeof props.projects[0] === 'string' ? props.projects[0] : null
  return (
    <ProjectFilterPicker
      label="Filter by project"
      selection={props.projects}
      projects={props.projectPaths}
      onPick={props.onPick}
      triggerClassName={cn('dshx:h-7 dshx:max-w-44 dshx:px-2 dshx:text-xs', count === 0 ? 'dshx:text-muted-foreground' : 'dshx:text-foreground')}
      trigger={
        <>
          {singleProject !== null ? <ItemGlyphs.ProjectDot project={singleProject} /> : <FolderIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />}
          <span className="dshx:min-w-0 dshx:truncate dshx:@max-pane-compact:sr-only" title={pathTitle}>
            {label}
          </span>
        </>
      }
    />
  )
}

const FilterMenu = (props: {
  readonly kinds: readonly BacklogKind[]
  readonly setKinds: (kinds: BacklogKind[]) => void
  readonly showDormant: boolean
  readonly setShowDormant: (value: boolean) => void
}): JSX.Element => {
  const active = props.kinds.length + Number(props.showDormant)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Filter"
        className={cn(
          'dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:text-xs dshx:outline-none dshx:transition-colors dshx:hover:bg-accent',
          active > 0 ? 'dshx:text-foreground' : 'dshx:text-muted-foreground',
        )}
      >
        <ListFilterIcon className="dshx:size-3.5" />
        <span className="dshx:@max-pane-compact:sr-only">Filter</span>
        {active > 0 ? <span className="dshx:rounded-full dshx:bg-info/15 dshx:px-1.5 dshx:text-[10px] dshx:text-info">{active}</span> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="dshx-root dshx:w-56">
        <DropdownMenuLabel className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">Kind</DropdownMenuLabel>
        {BacklogItems.kinds.map(kind => (
          <DropdownMenuCheckboxItem
            key={kind}
            checked={props.kinds.includes(kind)}
            onSelect={event => event.preventDefault()}
            onCheckedChange={checked => props.setKinds(checked ? [...props.kinds, kind] : props.kinds.filter(other => other !== kind))}
            className="dshx:gap-2 dshx:text-[13px]"
          >
            <ItemGlyphs.KindIcon kind={kind} />
            {ItemGlyphs.kindLabels[kind]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={props.showDormant} onCheckedChange={checked => props.setShowDormant(checked)} className="dshx:text-[13px]">
          Include dormant, archived and snoozed
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type SavedView = BacklogSettings['savedViews'][number]

/** Searches saved to the plugin's Host settings, so every browser lists the same views. */
const SavedViews = (props: {
  readonly views: readonly SavedView[]
  readonly query: string
  readonly view: View
  readonly writable: boolean
  readonly save: (views: SavedView[]) => void
  readonly apply: (saved: SavedView) => void
}): JSX.Element => {
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Saved views"
        className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:text-xs dshx:text-muted-foreground dshx:outline-none dshx:transition-colors dshx:hover:bg-accent dshx:hover:text-foreground"
      >
        <BookmarkIcon className="dshx:size-3.5" />
        <span className="dshx:@max-pane-compact:sr-only">Views</span>
        {props.views.length === 0 ? null : <span className="dshx:text-[10px] dshx:tabular-nums">{props.views.length}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="dshx-root dshx:w-72 dshx:p-1">
        {props.views.length === 0 ? (
          <p className="dshx:px-2 dshx:py-2 dshx:text-xs dshx:text-muted-foreground">No saved views yet. Search, then save it here.</p>
        ) : null}
        <ul className="dshx:flex dshx:flex-col">
          {props.views.map(saved => (
            <li key={saved.name} className="dshx:group/view dshx:flex dshx:items-center dshx:rounded-md dshx:hover:bg-accent">
              <button
                type="button"
                onClick={() => {
                  props.apply(saved)
                  setOpen(false)
                }}
                className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:px-2 dshx:py-1.5 dshx:text-left"
              >
                <span className="dshx:truncate dshx:text-[13px]">{saved.name}</span>
                <span className="dshx:truncate dshx:font-mono! dshx:text-[11px] dshx:text-muted-foreground">
                  {viewLabels[saved.view]}
                  {saved.query === '' ? '' : ` · ${saved.query}`}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Delete view ${saved.name}`}
                disabled={!props.writable}
                onClick={() => props.save(props.views.filter(other => other.name !== saved.name))}
                className="dshx:mr-1 dshx:rounded dshx:p-1 dshx:text-muted-foreground dshx:opacity-0 dshx:group-hover/view:opacity-100 dshx:hover:text-foreground"
              >
                <XIcon className="dshx:size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="dshx:mt-1 dshx:flex dshx:gap-1 dshx:border-t dshx:border-border dshx:p-1 dshx:pt-2"
          onSubmit={event => {
            event.preventDefault()
            if (name.trim() === '') return
            props.save([...props.views.filter(other => other.name !== name.trim()), { name: name.trim(), view: props.view, query: props.query }])
            setName('')
          }}
        >
          <input
            aria-label="View name"
            placeholder={props.query === '' ? `Save ${viewLabels[props.view]} as…` : `Save “${props.query}” as…`}
            value={name}
            disabled={!props.writable}
            onChange={event => setName(event.currentTarget.value)}
            className="dshx:h-7 dshx:min-w-0 dshx:flex-1 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-xs dshx:outline-none dshx:focus-visible:border-ring"
          />
        </form>
      </PopoverContent>
    </Popover>
  )
}

/** What the panel needs from the client entry to start a thread for an item; the entry owns those services. */
export interface StartThreadPorts {
  readonly listProjects: () => readonly StartThreadProject[]
  readonly loadCatalog: () => Promise<StartThreadCatalog>
  /** Every enabled agent, so the dialog can start the thread as one. */
  readonly listAgents: () => Promise<readonly StartThreadAgentChoice[]>
  readonly start: (request: StartThreadRequest) => Promise<StartThreadOutcome>
}

export const BacklogPanel = (props: {
  readonly openThread: OpenThread
  readonly listThreads: () => readonly ComposerThread[]
  readonly startThread: StartThreadPorts
  readonly agentForThread: (sessionId: string) => Promise<{ readonly name: string } | null>
}): JSX.Element => {
  const api = useApi(backlogApi)
  const actions = useBacklogActions()
  const [backfillJob, setBackfillJob] = useState<BacklogBackfillResult | null>(null)
  const [backfillError, setBackfillError] = useState<string | null>(null)
  const backfillJobId = backfillJob?.jobId
  const backfillJobState = backfillJob?.state
  useEffect(() => {
    if (backfillJobId === undefined || backfillJobId === null || backfillJobState === 'completed' || backfillJobState === 'failed') return
    let stopped = false
    let timer: number | undefined
    const refresh = async (): Promise<void> => {
      try {
        const next = await api.backfillTriageStatus({ jobId: backfillJobId })
        if (stopped) return
        if (next === null) {
          setBackfillError('This backfill is no longer available in this Host process.')
          return
        }
        setBackfillJob(next)
        if (next.state === 'queued' || next.state === 'running') timer = window.setTimeout(() => void refresh(), 1_000)
      } catch (error) {
        if (stopped) return
        setBackfillError(errorMessage(error, 'Could not read backfill progress.'))
        timer = window.setTimeout(() => void refresh(), 5_000)
      }
    }
    timer = window.setTimeout(() => void refresh(), 1_000)
    return () => {
      stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [api, backfillJobId, backfillJobState])
  const stored = preferences.useValue()
  const view = stored.view
  const setPreference = (change: Partial<typeof stored>): void => {
    preferences.set({ ...preferences.get(), ...change })
  }
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<BacklogKind[]>([])
  const [openIds, setOpenIds] = useState<BacklogViewSelection>({ feed: null, inbox: null, items: null, board: null, projects: null })
  const [cursorIds, setCursorIds] = useState<BacklogViewSelection>({ feed: null, inbox: null, items: null, board: null, projects: null })
  const openId = openIds[view]
  const cursorId = cursorIds[view]
  const setOpenId = useCallback((id: number | null): void => setOpenIds(selection => setBacklogViewSelection(selection, view, id)), [view])
  const setCursorId = useCallback((id: number | null): void => setCursorIds(selection => setBacklogViewSelection(selection, view, id)), [view])
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set(['dropped']))
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [captureStatus, setCaptureStatus] = useState<BacklogStatus | null>(null)
  const [startThreadItems, setStartThreadItems] = useState<readonly StartThreadItem[] | null>(null)
  const [backfillOpen, setBackfillOpen] = useState(false)
  const openStartThread = (items: readonly StartThreadItem[]): void => setStartThreadItems(items)
  const captureComposer = useRef<HTMLTextAreaElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const debounced = useDebouncedValue({ value: query, delayMs: 120 })

  const queryClient = useQueryClient()
  // A cheap number that changes with any write; lists and details refetch only when it moves.
  const revision = useQuery({
    queryKey: ['dshfiles-backlog-revision'],
    queryFn: ({ signal }) => api.revision(undefined, { signal }),
    refetchInterval: REFRESH_MS,
  })
  const lastRevision = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (revision.data === undefined) return
    if (lastRevision.current !== undefined && lastRevision.current !== revision.data) void queryClient.invalidateQueries({ queryKey: [BacklogQueries.key] })
    lastRevision.current = revision.data
  }, [revision.data, queryClient])
  // A conversation reference asks for one item; selecting it here is what the sidebar row cannot know.
  const focus = useSyncExternalStore(BacklogFocusModel.subscribe, BacklogFocusModel.read, () => null)
  useEffect(() => {
    if (focus === null) return
    setOpenId(focus)
    setCursorId(focus)
    setExpanded(false)
    const timer = window.setTimeout(BacklogFocusModel.clear, 0)
    return () => window.clearTimeout(timer)
  }, [focus, setCursorId, setOpenId])
  const projectFilters: (string | null)[] =
    stored.projects.length > 0
      ? stored.projects.map(project => (project === '' ? null : project))
      : stored.project === null
        ? []
        : [stored.project === '' ? null : stored.project]
  const projectFilterKey = projectFilters
  // `undefined` is not a JSON value, so an unfiltered list omits the key instead of carrying the scope along.
  const scoped = projectFilters.length === 0 ? {} : { projects: projectFilters }
  const list = useQuery({
    queryKey: [BacklogQueries.key, 'list', debounced, kinds, projectFilterKey, debounced === '' ? [] : stored.statuses],
    queryFn: async ({ signal }) => {
      const input: Parameters<typeof api.list>[0] = { query: debounced, kinds, ...scoped, freshness: 'all', limit: debounced === '' ? 2_000 : 200 }
      if (debounced !== '' && stored.statuses.length > 0) input.statuses = stored.statuses
      return BacklogViews.list(await api.list(input, { signal }))
    },
    placeholderData: keepPreviousData,
  })
  const searchStatusCounts = useQuery({
    queryKey: [BacklogQueries.key, 'search-status-counts', debounced, kinds, projectFilterKey],
    queryFn: async ({ signal }) => {
      const counts = await Promise.all(
        BacklogItems.statuses.map(async status => {
          const result = await api.list({ query: debounced, kinds, statuses: [status], ...scoped, freshness: 'all', limit: 1 }, { signal })
          return [status, BacklogViews.list(result).total] as const
        }),
      )
      const totals = { inbox: 0, todo: 0, doing: 0, done: 0, dropped: 0 } satisfies Record<BacklogStatus, number>
      for (const [status, count] of counts) totals[status] = count
      return totals
    },
    enabled: debounced !== '',
  })
  const inbox = useQuery({
    queryKey: [BacklogQueries.key, 'list', 'inbox', projectFilterKey],
    queryFn: async ({ signal }) => BacklogViews.list(await api.list({ inbox: true, ...scoped, freshness: 'all', limit: 200 }, { signal })),
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
    enabled: inboxThreadsMode !== 'off',
  })
  const attentionOwnerMissing = isApiOwnerMissing(attention.error)
  const now = list.dataUpdatedAt
  const all = useMemo(() => list.data?.items ?? [], [list.data])
  const items = useMemo(
    () => (stored.showDormant || debounced !== '' ? all : all.filter(item => isVisible(item, now))),
    [all, stored.showDormant, debounced, now],
  )
  const filteredItems = useMemo(() => FeedStatus.filter(items, stored.statuses), [items, stored.statuses])
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
  const unread = inboxItems.filter(item => item.acknowledgedAt === null || item.acknowledgedAt < item.lastActivityAt).length
  const tags = useMemo(() => [...new Set(all.flatMap(item => item.tags))].sort(), [all])
  const threads = props.listThreads()
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
    // Rows and cards share a view-transition name per item, so Items ↔ Board morphs instead of cutting. The browser
    // snapshots every named element, so a large backlog switches instantly instead.
    if (items.length <= MAX_ANIMATED_ITEMS) withViewTransition(() => setPreference({ view: next }))
    else setPreference({ view: next })
    setExpanded(false)
  }
  const startCapture = (status: BacklogStatus | null): void => {
    setCaptureStatus(status)
    requestAnimationFrame(() => captureComposer.current?.focus())
  }

  const sort: BacklogSort = view === 'feed' || view === 'inbox' || view === 'items' ? stored.sort[view] : 'updated'
  const viewOrder = () => {
    if (debounced !== '') return all
    if (view === 'inbox') return inboxOrder(inboxItems, 'all', sort)
    if (view === 'items') return itemsOrder(filteredItems, stored.groupBy, collapsed, sort)
    if (view === 'feed')
      return sortBacklogItems(
        filteredItems.filter(item => !item.pinned),
        sort,
        'ascending',
      )
    return items
  }
  const order = viewOrder()
  const moveCursor = (step: number): void => {
    const index = order.findIndex(item => item.id === (cursorId ?? openId))
    const next = order[Math.min(order.length - 1, Math.max(0, index === -1 ? 0 : index + step))]
    if (next === undefined) return
    setCursorId(next.id)
    if (openId !== null || view === 'inbox') select(next.id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
    const viewKey = views[Number(event.key) - 1]
    if (viewKey !== undefined) switchView(viewKey)
    else if (event.key === 'j' || event.key === 'ArrowDown') moveCursor(1)
    else if (event.key === 'k' || event.key === 'ArrowUp') moveCursor(-1)
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
        id={openId}
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
    <main
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="dshx-root dshx:@container dshx:relative dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:bg-background dshx:text-foreground dshx:outline-none"
    >
      <header className="dshx:flex dshx:h-12 dshx:shrink-0 dshx:items-center dshx:gap-3 dshx:border-b dshx:border-border dshx:px-4">
        <h2 className="dshx:text-sm dshx:font-semibold dshx:@max-pane-narrow:hidden">Backlog</h2>
        <nav aria-label="Backlog views" className="dshx:flex dshx:items-center dshx:gap-0.5 dshx:rounded-lg dshx:bg-muted/60 dshx:p-0.5">
          {views.map((entry, index) => {
            const Icon = viewIcons[entry]
            return (
              <button
                key={entry}
                type="button"
                aria-current={view === entry ? 'page' : undefined}
                title={`${viewLabels[entry]} (${String(index + 1)})`}
                onClick={() => switchView(entry)}
                className={cn(
                  'dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2.5 dshx:text-xs dshx:font-medium dshx:transition-colors',
                  view === entry ? 'dshx:bg-background dshx:text-foreground dshx:shadow-xs' : 'dshx:text-muted-foreground dshx:hover:text-foreground',
                )}
              >
                <Icon aria-hidden className="dshx:size-3.5" />
                <span className="dshx:@max-pane-compact:sr-only">{viewLabels[entry]}</span>
                {entry === 'inbox' && inboxItems.length + inboxThreads.length > 0 ? (
                  <span
                    className={cn(
                      'dshx:min-w-4 dshx:rounded-full dshx:px-1 dshx:text-center dshx:text-[10px] dshx:tabular-nums',
                      unread > 0 ? 'dshx:bg-info dshx:text-white' : 'dshx:bg-muted dshx:text-muted-foreground',
                    )}
                  >
                    {inboxItems.length + inboxThreads.length}
                  </span>
                ) : null}
              </button>
            )
          })}
        </nav>
        <div className="dshx:ml-auto dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5">
          <label className="dshx:flex dshx:h-7 dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-border dshx:bg-card dshx:px-2 dshx:text-muted-foreground dshx:transition-colors dshx:focus-within:border-input">
            <SearchIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
            <input
              ref={searchInput}
              aria-label="Search backlog"
              placeholder="Search items, tags, links…"
              value={query}
              onChange={event => setQuery(event.currentTarget.value)}
              onKeyDown={event => {
                if (event.key !== 'Escape') return
                setQuery('')
                event.currentTarget.blur()
              }}
              className="dshx:w-44 dshx:min-w-0 dshx:bg-transparent dshx:text-xs dshx:text-foreground dshx:outline-none dshx:placeholder:text-muted-foreground dshx:@max-pane-compact:w-24"
            />
            {query === '' ? <Kbd className="dshx:@max-pane-compact:hidden">/</Kbd> : null}
          </label>
          <SavedViews
            views={savedViews}
            query={query}
            view={view}
            writable={settings.writable}
            save={views => {
              setPendingViews(views)
              void settings.set('savedViews', views).catch(() => setPendingViews(null))
            }}
            apply={saved => {
              setQuery(saved.query)
              switchView(saved.view)
            }}
          />
          <ProjectFilter projects={projectFilters} projectPaths={projectPaths} onPick={projects => setPreference({ projects: [...projects], project: null })} />
          {view === 'feed' || view === 'inbox' || view === 'items' ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Sort by ${sort === 'updated' ? 'last update' : 'creation date'}`}
                title={`Sort by ${sort === 'updated' ? 'last update' : 'creation date'}`}
                className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:text-xs dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground"
              >
                <ArrowDownWideNarrowIcon className="dshx:size-3.5" />
                <span className="dshx:@max-pane-compact:sr-only">{sort === 'updated' ? 'Last update' : 'Created'}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="dshx-root">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={value => {
                    if (value !== 'updated' && value !== 'created') return
                    setPreference({ sort: { ...stored.sort, [view]: value } })
                  }}
                >
                  <DropdownMenuRadioItem value="updated" className="dshx:text-[13px]">
                    Last update
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="created" className="dshx:text-[13px]">
                    Creation date
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <FilterMenu kinds={kinds} setKinds={setKinds} showDormant={stored.showDormant} setShowDormant={value => setPreference({ showDormant: value })} />
          <button
            type="button"
            aria-label="Backfill triage"
            title="Triage items captured before triage was set up"
            onClick={() => setBackfillOpen(true)}
            className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:text-xs dshx:text-muted-foreground dshx:transition-colors dshx:hover:bg-accent dshx:hover:text-foreground"
          >
            <WandSparklesIcon aria-hidden className="dshx:size-3.5" />
            <span className="dshx:@max-pane-compact:sr-only">Backfill</span>
          </button>
          <button
            type="button"
            onClick={() => startCapture(null)}
            className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1 dshx:rounded-md dshx:bg-primary dshx:px-2.5 dshx:text-xs dshx:font-medium dshx:text-primary-foreground dshx:transition-[opacity,transform] dshx:hover:opacity-90 dshx:active:scale-[0.98]"
          >
            <PlusIcon className="dshx:size-3.5" />
            <span className="dshx:@max-pane-narrow:sr-only">New</span>
          </button>
        </div>
      </header>
      {list.isError ? (
        <p className="dshx:px-4 dshx:py-2 dshx:text-xs dshx:text-destructive">{errorMessage(list.error, 'The backlog is unavailable.')}</p>
      ) : null}
      <div className="dshx:relative dshx:flex dshx:min-h-0 dshx:flex-1">
        {debounced !== '' ? (
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
            items={inboxItems}
            threads={inboxThreads}
            openId={openId}
            select={select}
            openThread={props.openThread}
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
                  items={filteredItems}
                  sort={stored.sort.feed}
                  counts={statusTotals}
                  statuses={stored.statuses}
                  toggleStatus={status => setPreference({ statuses: FeedStatus.toggle(stored.statuses, status) })}
                  clearStatuses={() => setPreference({ statuses: [] })}
                  openId={openId}
                  select={select}
                  loaded={list.isSuccess}
                  now={now}
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
                  setGroupBy={groupBy => withViewTransition(() => setPreference({ groupBy }))}
                  collapsed={collapsed}
                  setCollapsed={next => withViewTransition(() => setCollapsed(next))}
                  captureInto={startCapture}
                  projectPaths={projectPaths}
                  startThread={openStartThread}
                />
              )}
              {view === 'board' && (
                <BoardView items={items} openId={openId} open={select} captureInto={startCapture} projectPaths={projectPaths} startThread={openStartThread} />
              )}
              {view === 'projects' && (
                <ProjectsView
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
        onError={message => setBackfillError(message.length === 0 ? null : message)}
        run={async request => {
          setBackfillError(null)
          setBackfillJob(null)
          const started = await actions.backfillTriage.mutateAsync(request)
          setBackfillJob(started)
          void queryClient.invalidateQueries({ queryKey: [BacklogQueries.key] })
        }}
        close={() => setBackfillOpen(false)}
      />
      {backfillJob !== null && !backfillOpen && (backfillJob.state === 'queued' || backfillJob.state === 'running') ? (
        <button
          type="button"
          className="dshx:fixed dshx:bottom-5 dshx:right-5 dshx:z-40 dshx:rounded-md dshx:border dshx:border-border dshx:bg-background dshx:px-3 dshx:py-2 dshx:text-xs dshx:shadow-lg"
          onClick={() => setBackfillOpen(true)}
        >
          Backfill running: {backfillJob.completed}/{backfillJob.total}
        </button>
      ) : null}
      <div className="dshx:shrink-0 dshx:px-4 dshx:pt-1 dshx:pb-4">
        <div className="dshx:mx-auto dshx:max-w-4xl">
          <Composer
            variant="chat"
            draftKey="feed"
            placeholder="Capture a thought, a task, a bug… like sending a message"
            tags={tags}
            threads={threads}
            projects={projectPaths}
            projectFilter={projectFilters.length === 0 ? null : projectFilters.length === 1 ? (projectFilters[0] ?? null) : null}
            reuseProject={settings.value?.reuseCaptureProject ?? true}
            status={captureStatus}
            onClearStatus={() => setCaptureStatus(null)}
            inputRef={captureComposer}
          />
        </div>
      </div>
    </main>
  )
}
