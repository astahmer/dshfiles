import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi, useSettings } from '@dshfiles/dshx/client'
import { threadSidebarAttentionApi } from '@dshfiles/thread-sidebar/attention-api'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import {
  KeyRoundIcon,
  ArrowDownWideNarrowIcon,
  BookmarkIcon,
  BotIcon,
  BotOffIcon,
  FolderIcon,
  FolderKanbanIcon,
  XIcon,
  InboxIcon,
  KanbanIcon,
  LoaderCircleIcon,
  ListFilterIcon,
  MessagesSquareIcon,
  PlusIcon,
  RocketIcon,
  Rows3Icon,
  SearchIcon,
  Settings2Icon,
  WandSparklesIcon,
  PlayIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, keepPreviousData, useIsMutating, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { Effect, Schema } from 'effect'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { backlogApi, BacklogViews, type BacklogBackfillResult, type BacklogSummaryView } from './api.js'
import { BackfillDialog } from './backfill-dialog.js'
import { BoardView } from './board-view.js'
import { setBacklogViewSelection, type BacklogView, type BacklogViewSelection } from './view-selection.js'
import { Composer, type ComposerThread } from './composer.js'
import type { BacklogImageEditorHandle } from './image-reference-editor.js'
import { FeedView } from './feed-view.js'
import type { BacklogSort } from './backlog-sort.js'
import { inboxThreadsFrom } from './inbox-threads.js'
import { InboxView } from './inbox-view.js'
import { BacklogItems, type BacklogKind, type BacklogStatus } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'
import { BacklogPeek } from './item-peek.js'
import { ItemsView } from './items-view.js'
import { panelDraftKey } from './panel-draft.js'
import { BacklogProjectPaths } from './project-paths.js'
import { ProjectsView } from './projects-view.js'
import { BacklogShipped } from './shipped.js'
import { AgentRunStates } from './agent-run-state.js'
import { WorkGlyphs } from './work-glyphs.js'
import { ShippedView } from './shipped-view.js'
import { ProjectFilterPicker } from './project-picker.js'
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

type OpenThread = (sessionId: string) => void
type View = BacklogView

/** Agents write from other threads; a short poll keeps the open panel current without a push channel. */
const REFRESH_MS = 5_000
const MAX_ANIMATED_ITEMS = 150
// Ready came last so the number keys of the older views stay as they were.
const views = ['feed', 'inbox', 'items', 'board', 'projects', 'shipped', 'ready'] as const
const viewLabels = {
  feed: 'Feed',
  inbox: 'Inbox',
  ready: 'Ready',
  items: 'Items',
  board: 'Board',
  projects: 'Projects',
  shipped: 'Shipped',
} satisfies Record<View, string>
const viewIcons = {
  feed: MessagesSquareIcon,
  inbox: InboxIcon,
  ready: PlayIcon,
  items: Rows3Icon,
  board: KanbanIcon,
  projects: FolderKanbanIcon,
  shipped: RocketIcon,
} as const

const sortOrderSchema = Schema.Literals(['updated', 'created', 'priority', 'due'])
const defaultSort = { feed: 'updated', inbox: 'updated', items: 'updated' } as const

/** Each view, and the full search results, keeps its own "Hide agent items" choice; hiding is the default. */
type AgentItemsScope = View | 'search'
const hideAgentItemsDefaults = { feed: true, inbox: true, ready: true, items: true, board: true, projects: true, shipped: true, search: true } as const
const hiddenByDefault = Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true)))

const sortOrders = ['updated', 'created', 'priority', 'due'] as const
const sortLabels = { updated: 'Last update', created: 'Created', priority: 'Priority', due: 'Due date' } satisfies Record<BacklogSort, string>
const sortNames = {
  updated: 'last update',
  created: 'creation date',
  priority: 'priority, then oldest',
  due: 'due date, soonest first',
} satisfies Record<BacklogSort, string>

const preferencesSchema = Schema.Struct({
  view: Schema.Literals(views),
  groupBy: Schema.Literals(['status', 'kind', 'project', 'attention', 'priority', 'parent', 'due']),
  showDormant: Schema.Boolean,
  statuses: Schema.Array(Schema.Literals(BacklogItems.statuses)).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  project: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  projects: Schema.Array(Schema.NullOr(Schema.String)).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  sort: Schema.Struct({
    feed: sortOrderSchema.pipe(Schema.withDecodingDefaultKey(Effect.succeed('updated'))),
    inbox: sortOrderSchema.pipe(Schema.withDecodingDefaultKey(Effect.succeed('updated'))),
    items: sortOrderSchema.pipe(Schema.withDecodingDefaultKey(Effect.succeed('updated'))),
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(defaultSort))),
  hideAgentItems: Schema.Struct({
    feed: hiddenByDefault,
    inbox: hiddenByDefault,
    ready: hiddenByDefault,
    items: hiddenByDefault,
    board: hiddenByDefault,
    projects: hiddenByDefault,
    shipped: hiddenByDefault,
    search: hiddenByDefault,
  }).pipe(Schema.withDecodingDefaultKey(Effect.succeed(hideAgentItemsDefaults))),
  shippedPeriod: Schema.Literals(BacklogShipped.unitPeriods).pipe(Schema.withDecodingDefaultKey(Effect.succeed('week'))),
})

const preferences = createStoredValue({
  key: 'dshfiles.backlog.view.v2',
  schema: preferencesSchema,
  fallback: {
    view: 'feed' as const,
    groupBy: 'status' as const,
    showDormant: false,
    statuses: [],
    project: null,
    projects: [],
    sort: { feed: 'updated' as const, inbox: 'updated' as const, items: 'updated' as const },
    hideAgentItems: hideAgentItemsDefaults,
    shippedPeriod: 'week' as const,
  },
})

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
          <span className="dshx:min-w-0 dshx:truncate dshx:whitespace-nowrap dshx:@max-[80rem]:sr-only">
            <Tooltip>
              <TooltipTrigger asChild>
                <span>{label}</span>
              </TooltipTrigger>
              <TooltipContent>{pathTitle}</TooltipContent>
            </Tooltip>
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
        <span className="dshx:whitespace-nowrap dshx:@max-[80rem]:sr-only">Filter</span>
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

/** Hides items agents captured that you have not touched yet; the badge counts what this view hides. */
const AgentItemsToggle = (props: { readonly hidden: boolean; readonly hiddenCount: number; readonly toggle: () => void }): JSX.Element => {
  const Icon = props.hidden ? BotOffIcon : BotIcon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Hide agent items"
          aria-pressed={props.hidden}
          onClick={props.toggle}
          className={cn(
            'dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:text-xs dshx:transition-colors dshx:hover:bg-accent',
            props.hidden ? 'dshx:text-foreground' : 'dshx:text-muted-foreground',
          )}
        >
          <Icon aria-hidden className="dshx:size-3.5" />
          <span className="dshx:whitespace-nowrap dshx:@max-[80rem]:sr-only">Agent items</span>
          {props.hidden && props.hiddenCount > 0 ? (
            <span className="dshx:rounded-full dshx:bg-muted dshx:px-1.5 dshx:text-[10px] dshx:tabular-nums dshx:text-muted-foreground">
              {props.hiddenCount}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {props.hidden
          ? `${String(props.hiddenCount)} agent ${props.hiddenCount === 1 ? 'item' : 'items'} hidden until you touch them; click to show`
          : 'Showing agent items; click to hide the ones you have not touched'}
      </TooltipContent>
    </Tooltip>
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
        <span className="dshx:whitespace-nowrap dshx:@max-[80rem]:sr-only">Views</span>
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

/** Opens Settings on the one shared Jev key (settings-shell's `jevSecret`, under Tools & MCP › Jev). */
const openJevKeySettings = (): void => {
  window.dispatchEvent(
    new CustomEvent('dshfiles:open-settings', { detail: { setting: { entryId: 'dshfiles-settings-shell', fieldPath: ['jevSecret'] } }, cancelable: true }),
  )
}

const BacklogSettingsPanel = (): JSX.Element => {
  const settings = useSettings(backlogSettings)
  const [jevEnabled, setJevEnabled] = useState(settings.value?.jevEnabled ?? false)
  const [autoTriage, setAutoTriage] = useState(settings.value?.autoTriage ?? false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (dirty || settings.status !== 'ready') return
    setJevEnabled(settings.value?.jevEnabled ?? false)
    setAutoTriage(settings.value?.autoTriage ?? false)
  }, [dirty, settings.status, settings.value?.autoTriage, settings.value?.jevEnabled])

  const save = async (): Promise<void> => {
    setError(null)
    setSaved(false)
    try {
      if (settings.status !== 'ready' || !settings.writable) throw new Error('Backlog settings are not writable right now.')
      if (!(await settings.set('jevEnabled', jevEnabled))) throw new Error('Backlog could not save Jev settings.')
      if (!(await settings.set('autoTriage', autoTriage))) throw new Error('Backlog could not save automatic triage settings.')
      setDirty(false)
      setSaved(true)
    } catch (cause) {
      setError(errorMessage(cause, 'Could not save Jev settings.'))
    }
  }

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
          void save()
        }}
      >
        <label className="dshx:flex dshx:items-start dshx:gap-3 dshx:text-sm">
          <input
            type="checkbox"
            aria-label="Enable Jev"
            checked={jevEnabled}
            disabled={!settings.writable || settings.status !== 'ready'}
            onChange={event => {
              setJevEnabled(event.currentTarget.checked)
              setDirty(true)
              setSaved(false)
            }}
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
            checked={autoTriage}
            disabled={!settings.writable || settings.status !== 'ready'}
            onChange={event => {
              setAutoTriage(event.currentTarget.checked)
              setDirty(true)
              setSaved(false)
            }}
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
            One key serves Backlog triage and Memory. Set it in Settings › Tools & MCP › Jev; without it, TYPESAFE_API_KEY from the DSH Host environment is
            used.
          </span>
          <Button type="button" variant="outline" size="sm" className="dshx:self-start" onClick={openJevKeySettings}>
            <KeyRoundIcon aria-hidden /> Open Jev settings
          </Button>
        </div>
        {error === null ? null : (
          <p className="dshx:text-sm dshx:text-destructive" role="alert">
            {error}
          </p>
        )}
        {saved ? (
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
  const [showSettings, setShowSettings] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set(['dropped']))
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [captureStatus, setCaptureStatus] = useState<BacklogStatus | null>(null)
  const [captureRequest, setCaptureRequest] = useState<{ readonly id: number; readonly text: string } | undefined>()
  const [startThreadItems, setStartThreadItems] = useState<readonly StartThreadItem[] | null>(null)
  const [backfillOpen, setBackfillOpen] = useState(false)
  const openStartThread = (items: readonly StartThreadItem[]): void => setStartThreadItems(items)
  const captureComposer = useRef<BacklogImageEditorHandle | null>(null)
  const panelRoot = useRef<HTMLElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const debounced = useDebouncedValue({ value: query, delayMs: 120 })
  const showsResults = SearchScopes.showsResults({ query: debounced, submitted: search.submitted })
  const agentItemsScope: AgentItemsScope = showsResults ? 'search' : view
  const hideAgentItems = stored.hideAgentItems[agentItemsScope]

  const queryClient = useQueryClient()
  // A cheap number that changes with any write; lists and details refetch only when it moves.
  const revision = useQuery({
    queryKey: ['dshfiles-backlog-revision'],
    queryFn: ({ signal }) => api.revision(undefined, { signal }),
    refetchInterval: REFRESH_MS,
  })
  const aiActivity = useQuery({
    queryKey: [BacklogQueries.key, 'ai-activity'],
    queryFn: ({ signal }) => api.aiActivity(undefined, { signal }),
    retry: false,
    refetchInterval: query => (query.state.error === null ? 1_000 : false),
  })
  const aiWorking =
    triagePending || (aiActivity.error === null && aiActivity.data?.active === true) || backfillJobState === 'queued' || backfillJobState === 'running'
  const lastRevision = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (revision.data === undefined) return
    if (lastRevision.current !== undefined && lastRevision.current !== revision.data) void queryClient.invalidateQueries({ queryKey: [BacklogQueries.key] })
    lastRevision.current = revision.data
  }, [revision.data, queryClient])
  usePanelRequests({
    draftKey,
    visible: props.visible !== false,
    onCapture: setCaptureRequest,
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
  }
  const startCapture = (status: BacklogStatus | null): void => {
    setCaptureStatus(status)
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

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.target instanceof HTMLElement && event.target.closest('[role="menu"], [role="dialog"]') !== null) return
    if (event.key === 'Enter' && event.target instanceof HTMLElement && event.target.closest('button, a[href]') !== null) return
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
        className="dshx-root dshx:@container dshx:relative dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:bg-background dshx:text-foreground dshx:outline-none"
      >
        <header className="dshx:flex dshx:h-12 dshx:shrink-0 dshx:items-center dshx:gap-3 dshx:border-b dshx:border-border dshx:px-4 dshx:@max-pane-narrow:gap-2 dshx:@max-pane-narrow:px-3 dshx:@max-pane-compact:overflow-x-auto">
          <h1 className="dshx:shrink-0 dshx:text-base dshx:font-semibold dshx:tracking-[-0.01em] dshx:@max-pane-compact:sr-only">Backlog</h1>
          <nav aria-label="Backlog views" className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-0.5 dshx:rounded-lg dshx:bg-muted/60 dshx:p-0.5">
            {views.map((entry, index) => {
              const Icon = viewIcons[entry]
              return (
                <Tooltip key={entry}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-current={view === entry ? 'page' : undefined}
                      onClick={() => switchView(entry)}
                      className={cn(
                        'dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2.5 dshx:text-xs dshx:font-medium dshx:transition-colors',
                        view === entry ? 'dshx:bg-background dshx:text-foreground dshx:shadow-xs' : 'dshx:text-muted-foreground dshx:hover:text-foreground',
                      )}
                    >
                      <Icon aria-hidden className="dshx:size-3.5" />
                      <span className="dshx:@max-pane-compact:sr-only">{viewLabels[entry]}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{`${viewLabels[entry]} (${String(index + 1)})`}</TooltipContent>
                </Tooltip>
              )
            })}
          </nav>
          <div className="dshx:ml-auto dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:@max-pane-compact:shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="dshx:flex dshx:h-7 dshx:min-w-28 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-border dshx:bg-card dshx:px-2 dshx:text-muted-foreground dshx:transition-colors dshx:focus-within:border-input">
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
                    className="dshx:w-44 dshx:min-w-0 dshx:bg-transparent dshx:text-xs dshx:text-foreground dshx:outline-none dshx:placeholder:text-muted-foreground dshx:@max-pane-compact:w-24"
                  />
                  {query === '' ? (
                    <Kbd className="dshx:@max-pane-compact:hidden">/</Kbd>
                  ) : search.submitted ? null : (
                    <Kbd className="dshx:@max-pane-compact:hidden">↵</Kbd>
                  )}
                </label>
              </TooltipTrigger>
              <TooltipContent>Filters this view; press Enter for all results</TooltipContent>
            </Tooltip>
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
                switchView(saved.view)
                setSearch(scope => SearchScopes.type(SearchScopes.leaveResults(scope), saved.query))
              }}
            />
            <ProjectFilter
              projects={projectFilters}
              projectPaths={projectPaths}
              onPick={projects => setPreference({ projects: [...projects], project: null })}
            />
            {view === 'feed' || view === 'inbox' || view === 'items' ? (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger
                      aria-label={`Sort by ${sortNames[sort]}`}
                      className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:text-xs dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground"
                    >
                      <ArrowDownWideNarrowIcon className="dshx:size-3.5" />
                      <span className="dshx:whitespace-nowrap dshx:@max-[80rem]:sr-only">{sortLabels[sort]}</span>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{`Sort by ${sortNames[sort]}`}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="dshx-root">
                  <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={sort}
                    onValueChange={value => {
                      const next = sortOrders.find(candidate => candidate === value)
                      if (next === undefined || (next === 'priority' && view !== 'items')) return
                      setPreference({ sort: { ...stored.sort, [view]: next } })
                    }}
                  >
                    <DropdownMenuRadioItem value="updated" className="dshx:text-[13px]">
                      Last update
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="created" className="dshx:text-[13px]">
                      Creation date
                    </DropdownMenuRadioItem>
                    {view === 'items' ? (
                      <DropdownMenuRadioItem value="priority" className="dshx:text-[13px]">
                        Priority
                      </DropdownMenuRadioItem>
                    ) : null}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {view === 'shipped' && !showsResults ? null : (
              <AgentItemsToggle
                hidden={hideAgentItems}
                hiddenCount={(view === 'inbox' && !showsResults ? inbox.data : list.data)?.hiddenAgentItems ?? 0}
                toggle={() => setPreference({ hideAgentItems: { ...stored.hideAgentItems, [agentItemsScope]: !hideAgentItems } })}
              />
            )}
            {view === 'shipped' && !showsResults ? null : (
              <FilterMenu kinds={kinds} setKinds={setKinds} showDormant={stored.showDormant} setShowDormant={value => setPreference({ showDormant: value })} />
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={showSettings ? 'Backlog views' : 'Backlog settings'}
                  onClick={() => setShowSettings(value => !value)}
                  aria-pressed={showSettings}
                  className={cn(
                    'dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:text-xs dshx:transition-colors dshx:hover:bg-accent',
                    showSettings ? 'dshx:text-foreground' : 'dshx:text-muted-foreground',
                  )}
                >
                  <Settings2Icon aria-hidden className="dshx:size-3.5" />
                  <span className="dshx:whitespace-nowrap dshx:@max-[80rem]:sr-only">{showSettings ? 'Backlog' : 'Settings'}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{showSettings ? 'Back to backlog' : 'Backlog settings'}</TooltipContent>
            </Tooltip>
            {showSettings ? null : (
              <>
                <span
                  role={aiWorking ? 'status' : undefined}
                  aria-label={aiWorking ? 'AI is working' : undefined}
                  aria-hidden={aiWorking ? undefined : true}
                  className={cn(
                    'dshx:inline-flex dshx:size-7 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:text-muted-foreground dshx:transition-opacity',
                    aiWorking ? 'dshx:opacity-70' : 'dshx:opacity-0',
                  )}
                >
                  <LoaderCircleIcon aria-hidden className={cn('dshx:size-3.5', aiWorking && 'dshx:animate-spin')} />
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Backfill triage"
                      onClick={() => setBackfillOpen(true)}
                      className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:text-xs dshx:text-muted-foreground dshx:transition-colors dshx:hover:bg-accent dshx:hover:text-foreground"
                    >
                      <WandSparklesIcon aria-hidden className="dshx:size-3.5" />
                      <span className="dshx:whitespace-nowrap dshx:@max-[80rem]:sr-only">Backfill</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Triage items captured before triage was set up</TooltipContent>
                </Tooltip>
                <Button type="button" size="sm" onClick={() => startCapture(null)}>
                  <PlusIcon className="dshx:size-3.5" />
                  <span className="dshx:@max-pane-narrow:sr-only">New</span>
                </Button>
              </>
            )}
          </div>
        </header>
        {list.isError ? (
          <p role="alert" className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:px-4 dshx:py-2 dshx:text-xs dshx:text-destructive">
            <span className="dshx:min-w-0">{errorMessage(list.error, 'The backlog is unavailable.')}</span>
            <Button size="xs" variant="outline" onClick={() => void list.refetch()}>
              Try again
            </Button>
          </p>
        ) : null}
        <div data-backlog-content-region className="dshx:relative dshx:flex dshx:min-h-0 dshx:flex-1 dshx:@max-pane-compact:flex-col">
          {showSettings ? (
            <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:overflow-y-auto">
              <BacklogSettingsPanel />
              <BacklogSyncControls.Settings projectPaths={projectPaths} />
              <BacklogHostsSettings />
              <BacklogExportSettings />
            </div>
          ) : null}
          {!showSettings &&
            (showsResults ? (
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
                      openSettings={() => setShowSettings(true)}
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
            ))}
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
        {showSettings ? null : (
          <div className="dshx:shrink-0 dshx:px-4 dshx:pt-1 dshx:pb-4">
            <div className="dshx:mx-auto dshx:max-w-4xl">
              <Composer
                key={draftKey}
                variant="chat"
                draftKey={draftKey}
                placeholder="Capture a thought, a task, a bug… like sending a message"
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
                {...(captureRequest === undefined ? {} : { captureRequest })}
              />
            </div>
          </div>
        )}
      </main>
    </PanelProviders>
  )
}
