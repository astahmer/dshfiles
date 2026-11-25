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
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { tabsListVariants } from '@dshfiles/plugin-ui/components/ui/tabs'
import { Toggle } from '@dshfiles/plugin-ui/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { CheckIcon, ChevronDownIcon, FolderIcon, ListFilterIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, type ReactNode } from 'react'

import type { BacklogSort } from './backlog-sort.js'
import { BacklogItems, type BacklogKind, type BacklogStatus } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'
import { views } from './panel-preferences.js'
import { ProjectFilterPicker } from './project-picker.js'
import { visibleStatuses } from './status-filter-bar.js'
import type { BacklogSettings } from './settings.js'
import type { BacklogView } from './view-selection.js'

type View = BacklogView
type SavedView = BacklogSettings['savedViews'][number]

export const viewLabels = {
  feed: 'Feed',
  inbox: 'Inbox',
  ready: 'Ready',
  items: 'Items',
  board: 'Board',
  projects: 'Projects',
  shipped: 'Shipped',
} satisfies Record<View, string>

const sortLabels = { updated: 'Last update', created: 'Created', priority: 'Priority', due: 'Due date' } satisfies Record<BacklogSort, string>
export const sortNames = {
  updated: 'last update',
  created: 'creation date',
  priority: 'priority, then oldest',
  due: 'due date, soonest first',
} satisfies Record<BacklogSort, string>
const sortOrders = ['updated', 'created', 'priority', 'due'] as const

/** The kit segmented tab, drawn on buttons so each view stays a navigation link with `aria-current`. */
const tabClass = (active: boolean): string =>
  cn(
    'dshx:relative dshx:inline-flex dshx:h-full dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-transparent dshx:px-2.5 dshx:text-sm dshx:font-medium dshx:whitespace-nowrap dshx:outline-none dshx:transition-colors dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50',
    active
      ? 'dshx:bg-background dshx:text-foreground dshx:shadow-sm dshx:dark:border-input dshx:dark:bg-input/30'
      : 'dshx:text-foreground/60 dshx:hover:text-foreground dshx:dark:text-muted-foreground dshx:dark:hover:text-foreground',
  )

/**
 * The Backlog's views: labelled segmented tabs, and one labelled select once the pane is phone-narrow, so no view is
 * ever an unlabeled icon. Holding the shortcut modifier shows each tab's digit.
 */
export const BacklogViewSwitch = (props: { readonly view: View; readonly onSelect: (view: View) => void; readonly modifierHeld: boolean }): JSX.Element => (
  <>
    <nav aria-label="Backlog views" className={cn(tabsListVariants(), 'dshx:h-8 dshx:shrink-0 dshx:@max-pane-narrow:hidden')}>
      {views.map((entry, index) => (
        <Tooltip key={entry}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-current={props.view === entry ? 'page' : undefined}
              onClick={() => props.onSelect(entry)}
              className={tabClass(props.view === entry)}
            >
              {viewLabels[entry]}
              {props.modifierHeld ? (
                <kbd aria-hidden className="dshx:font-mono dshx:text-2xs dshx:text-muted-foreground dshx:tabular-nums">
                  {index + 1}
                </kbd>
              ) : null}
            </button>
          </TooltipTrigger>
          <TooltipContent>{`${viewLabels[entry]} (${String(index + 1)})`}</TooltipContent>
        </Tooltip>
      ))}
    </nav>
    <div className="dshx:hidden dshx:min-w-0 dshx:flex-1 dshx:@max-pane-narrow:block">
      <Select
        value={props.view}
        onValueChange={value => {
          const next = views.find(candidate => candidate === value)
          if (next !== undefined) props.onSelect(next)
        }}
      >
        <SelectTrigger aria-label="Backlog view" size="sm" className="dshx:w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="dshx-root">
          {views.map(entry => (
            <SelectItem key={entry} value={entry}>
              {viewLabels[entry]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  </>
)

/** A view's status filter, shown as the Filter menu's first group where the view has no status row of its own. */
export interface StatusFilter {
  readonly counts: Record<BacklogStatus, number>
  readonly statuses: readonly BacklogStatus[]
  readonly toggle: (status: BacklogStatus) => void
  readonly clear: () => void
}

/** Status (where given), kind and dormancy filters; the count of active ones is muted, never a signal colour. */
export const FilterMenu = (props: {
  readonly kinds: readonly BacklogKind[]
  readonly setKinds: (kinds: BacklogKind[]) => void
  readonly showDormant: boolean
  readonly setShowDormant: (value: boolean) => void
  readonly status?: StatusFilter | undefined
}): JSX.Element => {
  const status = props.status
  const active = props.kinds.length + Number(props.showDormant) + (status?.statuses.length ?? 0)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label="Filter" className={active > 0 ? 'dshx:text-foreground' : 'dshx:text-muted-foreground'}>
          <ListFilterIcon aria-hidden />
          <span className="dshx:@max-pane-narrow:sr-only">Filter</span>
          {active > 0 ? <span className="dshx:text-2xs dshx:text-muted-foreground dshx:tabular-nums">{active}</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="dshx-root dshx:w-56">
        {status === undefined ? null : (
          <>
            <DropdownMenuLabel className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">Status</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={status.statuses.length === 0}
              onSelect={event => event.preventDefault()}
              onCheckedChange={() => status.clear()}
              className="dshx:gap-2 dshx:text-sm"
            >
              All
              <span className="dshx:ml-auto dshx:text-2xs dshx:text-muted-foreground dshx:tabular-nums">
                {Object.values(status.counts).reduce((sum, count) => sum + count, 0)}
              </span>
            </DropdownMenuCheckboxItem>
            {visibleStatuses(status.counts, status.statuses).map(value => (
              <DropdownMenuCheckboxItem
                key={value}
                checked={status.statuses.includes(value)}
                onSelect={event => event.preventDefault()}
                onCheckedChange={() => status.toggle(value)}
                className="dshx:gap-2 dshx:text-sm"
              >
                <ItemGlyphs.StatusIcon status={value} />
                {ItemGlyphs.statusLabels[value]}
                <span className="dshx:ml-auto dshx:text-2xs dshx:text-muted-foreground dshx:tabular-nums">{status.counts[value]}</span>
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">Kind</DropdownMenuLabel>
        {BacklogItems.kinds.map(kind => (
          <DropdownMenuCheckboxItem
            key={kind}
            checked={props.kinds.includes(kind)}
            onSelect={event => event.preventDefault()}
            onCheckedChange={checked => props.setKinds(checked ? [...props.kinds, kind] : props.kinds.filter(other => other !== kind))}
            className="dshx:gap-2 dshx:text-sm"
          >
            <ItemGlyphs.KindIcon kind={kind} />
            {ItemGlyphs.kindLabels[kind]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={props.showDormant} onCheckedChange={checked => props.setShowDormant(checked)} className="dshx:text-sm">
          Include dormant, archived and snoozed
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const projectLabel = (projects: readonly (string | null)[]): string => {
  const labels = projects.flatMap(project => (project === null ? ['No project'] : [ItemGlyphs.projectName(project)]))
  return projects.length === 0 ? 'All projects' : projects.length === 1 ? (labels[0] ?? '1 project') : `${String(projects.length)} projects`
}

/** The searchable multi-select that narrows every backlog view to any chosen projects. */
const ProjectFilter = (props: {
  readonly projects: readonly (string | null)[]
  readonly projectPaths: readonly string[]
  readonly onPick: (projects: readonly (string | null)[]) => void
}): JSX.Element => {
  const singleProject = props.projects.length === 1 && typeof props.projects[0] === 'string' ? props.projects[0] : null
  return (
    <ProjectFilterPicker
      label="Filter by project"
      selection={props.projects}
      projects={props.projectPaths}
      onPick={props.onPick}
      triggerClassName={cn(
        'dshx:h-7 dshx:max-w-48 dshx:px-2 dshx:text-xs',
        props.projects.length === 0 ? 'dshx:text-muted-foreground' : 'dshx:text-foreground',
      )}
      trigger={
        <>
          {singleProject !== null ? <ItemGlyphs.ProjectDot project={singleProject} /> : <FolderIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />}
          <span className="dshx:min-w-0 dshx:truncate dshx:whitespace-nowrap">{projectLabel(props.projects)}</span>
          <ChevronDownIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:opacity-50" />
        </>
      }
    />
  )
}

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
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="dshx:w-full dshx:justify-between dshx:font-normal">
          Saved views
          <span aria-hidden className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-muted-foreground">
            {props.views.length === 0 ? null : <span className="dshx:text-2xs dshx:tabular-nums">{props.views.length}</span>}
            <ChevronDownIcon aria-hidden className="dshx:opacity-50" />
          </span>
        </Button>
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
                className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:rounded-md dshx:px-2 dshx:py-1.5 dshx:text-left dshx:outline-none dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50"
              >
                <span className="dshx:truncate dshx:text-sm">{saved.name}</span>
                <span className="dshx:truncate dshx:font-mono! dshx:text-2xs dshx:text-muted-foreground">
                  {viewLabels[saved.view]}
                  {saved.query === '' ? '' : ` · ${saved.query}`}
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Delete view ${saved.name}`}
                disabled={!props.writable}
                onClick={() => props.save(props.views.filter(other => other.name !== saved.name))}
                className="dshx:mr-1 dshx:text-muted-foreground dshx:opacity-0 dshx:group-hover/view:opacity-100 dshx:focus-visible:opacity-100"
              >
                <XIcon />
              </Button>
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
            className="dshx:h-7 dshx:min-w-0 dshx:flex-1 dshx:rounded-md dshx:border dshx:border-input dshx:bg-background dshx:px-2 dshx:text-xs dshx:outline-none dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50"
          />
        </form>
      </PopoverContent>
    </Popover>
  )
}

const ViewRow = (props: { readonly label: string; readonly children: ReactNode }): JSX.Element => (
  <div className="dshx:flex dshx:min-h-8 dshx:items-center dshx:justify-between dshx:gap-3 dshx:px-2">
    <span className="dshx:text-sm dshx:text-muted-foreground">{props.label}</span>
    {props.children}
  </div>
)

/**
 * One labelled "View" menu for how the current view reads: project scope, sort, agent items and saved views. The
 * trigger names a project scope so a narrowed backlog never looks complete.
 */
export const ViewMenu = (props: {
  readonly projects: readonly (string | null)[]
  readonly projectPaths: readonly string[]
  readonly setProjects: (projects: readonly (string | null)[]) => void
  /** Present only for views that sort (Feed, Inbox, Items). */
  readonly sort?: { readonly value: BacklogSort; readonly allowsPriority: boolean; readonly set: (sort: BacklogSort) => void } | undefined
  /** Absent where agent items cannot be hidden (Shipped). */
  readonly agentItems?: { readonly hidden: boolean; readonly hiddenCount: number; readonly toggle: () => void } | undefined
  readonly savedViews: Parameters<typeof SavedViews>[0]
}): JSX.Element => (
  <Popover>
    <PopoverTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Backlog view options"
        className={cn('dshx:max-w-56', props.projects.length === 0 ? 'dshx:text-muted-foreground' : 'dshx:text-foreground')}
      >
        View
        {props.projects.length === 0 ? null : (
          <span className="dshx:min-w-0 dshx:truncate dshx:font-normal dshx:text-muted-foreground">· {projectLabel(props.projects)}</span>
        )}
        <ChevronDownIcon aria-hidden className="dshx:opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="dshx-root dshx:flex dshx:w-80 dshx:flex-col dshx:gap-1 dshx:p-2">
      <ViewRow label="Projects">
        <ProjectFilter projects={props.projects} projectPaths={props.projectPaths} onPick={props.setProjects} />
      </ViewRow>
      {props.sort === undefined ? null : <SortRow sort={props.sort} />}
      {props.agentItems === undefined ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={props.agentItems.hidden}
              onPressedChange={props.agentItems.toggle}
              className="dshx:h-8 dshx:w-full dshx:justify-between dshx:px-2 dshx:font-normal dshx:data-[state=on]:bg-transparent dshx:hover:bg-accent dshx:hover:text-foreground"
            >
              Hide agent items
              <span aria-hidden className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-muted-foreground">
                {props.agentItems.hidden && props.agentItems.hiddenCount > 0 ? (
                  <span className="dshx:text-2xs dshx:tabular-nums">{props.agentItems.hiddenCount}</span>
                ) : null}
                {props.agentItems.hidden ? <CheckIcon aria-hidden className="dshx:size-3.5 dshx:text-foreground" /> : null}
              </span>
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>
            {props.agentItems.hidden
              ? `${String(props.agentItems.hiddenCount)} agent ${props.agentItems.hiddenCount === 1 ? 'item' : 'items'} hidden until you touch them. Click to show`
              : 'Showing agent items. Click to hide the ones you have not touched'}
          </TooltipContent>
        </Tooltip>
      )}
      <SavedViews {...props.savedViews} />
    </PopoverContent>
  </Popover>
)

const SortRow = (props: { readonly sort: NonNullable<Parameters<typeof ViewMenu>[0]['sort']> }): JSX.Element => (
  <ViewRow label="Sort">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={`Sort by ${sortNames[props.sort.value]}`}>
          {sortLabels[props.sort.value]}
          <ChevronDownIcon aria-hidden className="dshx:opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="dshx-root">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={props.sort.value}
          onValueChange={value => {
            const next = sortOrders.find(candidate => candidate === value)
            if (next === undefined || (next === 'priority' && !props.sort.allowsPriority)) return
            props.sort.set(next)
          }}
        >
          <DropdownMenuRadioItem value="updated" className="dshx:text-sm">
            Last update
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="created" className="dshx:text-sm">
            Creation date
          </DropdownMenuRadioItem>
          {props.sort.allowsPriority ? (
            <DropdownMenuRadioItem value="priority" className="dshx:text-sm">
              Priority
            </DropdownMenuRadioItem>
          ) : null}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </ViewRow>
)
