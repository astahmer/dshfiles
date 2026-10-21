import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  LayersIcon,
  LinkIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  PinIcon,
  PlusIcon,
  WandSparklesIcon,
  XIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useVirtualizer } from '@dshfiles/plugin-ui/virtual'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { BacklogSummaryView } from './api.js'
import { BacklogItems, type BacklogKind, type BacklogStatus } from './item.js'
import { BacklogInlineTitle, useBacklogInlineRename } from './item-inline-title.js'
import { ItemGlyphs } from './item-glyphs.js'
import { BacklogText } from './item-text.js'
import { ItemPickers } from './item-pickers.js'
import { extendBacklogSelection, toggleBacklogSelection } from './selection.js'
import { BacklogItemMenu } from './item-actions-menu.js'
import { StatusFilterBar } from './status-filter-bar.js'
import { startThreadItemOf, type StartThreadItem } from './start-thread.js'
import { useBacklogActions } from './use-backlog-actions.js'

type GroupBy = 'status' | 'kind' | 'project' | 'attention'
type Entry =
  | { readonly kind: 'header'; readonly key: string; readonly group: Group }
  | { readonly kind: 'row'; readonly key: string; readonly item: BacklogSummaryView }
type Group = { readonly key: string; readonly label: ReactNode; readonly status: BacklogStatus | null; readonly items: BacklogSummaryView[] }

const groupLabels = { status: 'Status', kind: 'Kind', project: 'Project', attention: 'Attention' } satisfies Record<GroupBy, string>
const groupByOf = (value: string): GroupBy => (value === 'kind' || value === 'project' || value === 'attention' ? value : 'status')
const columns =
  'dshx:grid dshx:grid-cols-[28px_minmax(0,1fr)_128px_96px_160px_64px_52px] dshx:@max-[56rem]:grid-cols-[28px_minmax(0,1fr)_120px_140px_52px] dshx:@max-pane-compact:grid-cols-[28px_minmax(0,1fr)_40px_52px]'
/** Kind and People go first when the table narrows (an open inspector), then Project. */
const roomyOnly = 'dshx:@max-[56rem]:hidden'
const wideOnly = 'dshx:@max-pane-compact:hidden'

const groupsOf = (items: readonly BacklogSummaryView[], by: GroupBy): Group[] => {
  if (by === 'status')
    return BacklogItems.statuses.map(status => ({
      key: status,
      status,
      label: (
        <>
          <ItemGlyphs.StatusIcon status={status} />
          {ItemGlyphs.statusLabels[status]}
        </>
      ),
      items: items.filter(item => item.status === status),
    }))
  if (by === 'kind')
    return BacklogItems.kinds.map(kind => ({
      key: kind,
      status: null,
      label: (
        <>
          <ItemGlyphs.KindIcon kind={kind} />
          {ItemGlyphs.kindLabels[kind]}
        </>
      ),
      items: items.filter(item => item.kind === kind),
    }))
  if (by === 'attention')
    return BacklogItems.attentions.map(attention => ({
      key: attention,
      status: null,
      label: attention === 'none' ? <span>No attention</span> : <ItemGlyphs.AttentionBadge attention={attention} />,
      items: items.filter(item => item.attention === attention),
    }))
  const projects = [...new Set(items.map(item => item.project ?? ''))].sort()
  return projects.map(project => ({
    key: project,
    status: null,
    label:
      project === '' ? (
        <span className="dshx:text-muted-foreground">No project</span>
      ) : (
        <>
          <ItemGlyphs.ProjectDot project={project} />
          {ItemGlyphs.projectName(project)}
        </>
      ),
    items: items.filter(item => (item.project ?? '') === project),
  }))
}

/** Rows in the order they render, for keyboard movement in the panel. */
export const itemsOrder = (items: readonly BacklogSummaryView[], by: GroupBy, collapsed: ReadonlySet<string>): BacklogSummaryView[] =>
  groupsOf(items, by)
    .filter(group => !collapsed.has(group.key))
    .flatMap(group => [...group.items].sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.lastActivityAt - left.lastActivityAt))

const Row = (props: {
  readonly item: BacklogSummaryView
  readonly open: boolean
  readonly cursor: boolean
  readonly selected: boolean
  readonly toggle: (id: number) => void
  readonly selectWithModifiers: (id: number, shiftKey: boolean, additive: boolean) => void
  readonly select: (id: number) => void
  readonly hover: (id: number) => void
  readonly startThread: (items: readonly StartThreadItem[]) => void
  /** The whole selection when this row belongs to one, so its menu starts one thread for all of it. */
  readonly startThreadSelection?: readonly StartThreadItem[] | undefined
  readonly projectPaths: readonly string[]
}): JSX.Element => {
  const actions = useBacklogActions()
  const modifiedCheckboxClick = useRef(false)
  const item = props.item
  const closed = item.status === 'done' || item.status === 'dropped'
  const rename = useBacklogInlineRename(() => props.select(item.id))
  const background = (() => {
    if (props.open) return 'dshx:bg-accent/80'
    if (props.selected) return 'dshx:bg-info/8'
    if (props.cursor) return 'dshx:bg-accent/45'
    return 'dshx:hover:bg-accent/30'
  })()
  return (
    <BacklogItemMenu
      item={item}
      projectPaths={props.projectPaths}
      update={input => actions.update.mutate(input)}
      triage={id => actions.triage.mutate(id)}
      startThread={props.startThread}
      selection={props.startThreadSelection}
      openItem={props.select}
    >
      <div
        role="row"
        aria-label={`Item b:${String(item.id)}`}
        aria-selected={props.selected}
        onClick={event => {
          if (rename.renaming) return
          if (event.shiftKey || event.metaKey || event.ctrlKey) {
            props.selectWithModifiers(item.id, event.shiftKey, event.metaKey || event.ctrlKey)
            return
          }
          rename.openSoon()
        }}
        onDoubleClick={rename.renameOnDoubleClick}
        onMouseMove={() => props.hover(item.id)}
        style={{ viewTransitionName: `backlog-item-${String(item.id)}` }}
        className={cn(
          columns,
          'dshx:group/row dshx:h-10 dshx:cursor-default dshx:items-center dshx:border-b dshx:border-border/50 dshx:pr-3 dshx:text-[13px] dshx:transition-colors dshx:duration-75',
          background,
        )}
      >
        <span className="dshx:flex dshx:justify-center" onClick={event => event.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`Select b:${String(item.id)}`}
            checked={props.selected}
            onClick={event => {
              if (!event.shiftKey && !event.metaKey && !event.ctrlKey) return
              modifiedCheckboxClick.current = true
              event.stopPropagation()
              props.selectWithModifiers(item.id, event.shiftKey, event.metaKey || event.ctrlKey)
            }}
            onChange={() => {
              if (modifiedCheckboxClick.current) {
                modifiedCheckboxClick.current = false
                return
              }
              props.toggle(item.id)
            }}
            className={cn(
              'dshx:size-3.5 dshx:accent-[var(--color-info)] dshx:transition-opacity',
              props.selected ? 'dshx:opacity-100' : 'dshx:opacity-0 dshx:group-hover/row:opacity-100',
            )}
          />
        </span>
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
          <span className="dshx:w-10 dshx:shrink-0 dshx:font-mono! dshx:text-[11px] dshx:text-muted-foreground">b:{item.id}</span>
          {rename.renaming ? (
            <BacklogInlineTitle
              id={item.id}
              title={item.title}
              cancel={rename.endRename}
              className="dshx:h-6 dshx:min-w-0 dshx:flex-1 dshx:border-0 dshx:bg-transparent dshx:p-0 dshx:text-[13px] dshx:font-medium dshx:shadow-none dshx:focus-visible:ring-1"
            />
          ) : (
            <BacklogText
              text={item.title}
              className={cn(
                'dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-[13px] dshx:[&>div]:truncate dshx:[&>div]:text-[13px]! dshx:[&>div]:leading-tight! dshx:[&>div]:font-medium! dshx:[&>div]:text-foreground! dshx:[&>div>p]:my-0 dshx:[&>div>p]:truncate',
                closed && 'dshx:text-muted-foreground dshx:line-through dshx:[&>div]:text-muted-foreground! dshx:[&>div]:line-through',
              )}
            />
          )}
          {item.pinned ? <PinIcon aria-label="Pinned" className="dshx:size-3 dshx:shrink-0 dshx:fill-current dshx:text-warning" /> : null}
          <ItemGlyphs.AttentionBadge attention={item.attention} compact />
          {item.proposal === null ? null : <WandSparklesIcon aria-label="Suggestion waiting" className="dshx:size-3 dshx:shrink-0 dshx:text-violet" />}
          {item.tags.slice(0, 2).map(tag => (
            <span key={tag} className="dshx:hidden dshx:shrink-0 dshx:text-[11px] dshx:text-muted-foreground dshx:@min-[52rem]:inline">
              #{tag}
            </span>
          ))}
          {item.links.length === 0 ? null : (
            <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-0.5 dshx:text-[11px] dshx:text-muted-foreground">
              <LinkIcon aria-hidden className="dshx:size-3" />
              {item.links.length}
            </span>
          )}
          {item.activity.comments === 0 ? null : (
            <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-0.5 dshx:text-[11px] dshx:text-muted-foreground">
              <MessageSquareIcon aria-hidden className="dshx:size-3" />
              {item.activity.comments}
            </span>
          )}
        </div>
        <span onClick={event => event.stopPropagation()} className="dshx:flex dshx:items-center">
          <span className={wideOnly}>
            <ItemPickers.Status id={item.id} status={item.status} withLabel onPick={status => actions.update.mutate({ id: item.id, status })} />
          </span>
          <span className="dshx:hidden dshx:@max-pane-compact:inline-flex">
            <ItemPickers.Status id={item.id} status={item.status} onPick={status => actions.update.mutate({ id: item.id, status })} />
          </span>
        </span>
        <span className={cn('dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-muted-foreground', roomyOnly)}>
          <ItemGlyphs.KindIcon kind={item.kind} />
          {ItemGlyphs.kindLabels[item.kind]}
        </span>
        <span className={cn('dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5', wideOnly)}>
          {item.project === null ? <span className="dshx:text-muted-foreground/60">—</span> : <ItemGlyphs.ProjectLabel project={item.project} />}
        </span>
        <span className={roomyOnly}>
          <ItemGlyphs.ActorStack actorIds={item.actors.map(actor => actor.id)} max={2} />
        </span>
        <span className="dshx:text-right dshx:text-[11px] dshx:tabular-nums dshx:text-muted-foreground">{ItemGlyphs.ago(item.lastActivityAt)}</span>
      </div>
    </BacklogItemMenu>
  )
}

/** Every item as a dense grouped table: group by status, kind, project or attention; select many to move them at once. */
export const ItemsView = (props: {
  readonly items: readonly BacklogSummaryView[]
  readonly openId: number | null
  readonly cursorId: number | null
  readonly select: (id: number) => void
  readonly hover: (id: number) => void
  readonly groupBy: GroupBy
  readonly setGroupBy: (value: GroupBy) => void
  readonly collapsed: ReadonlySet<string>
  readonly setCollapsed: (value: ReadonlySet<string>) => void
  readonly captureInto: (status: BacklogStatus) => void
  readonly counts: Record<BacklogStatus, number>
  readonly statuses: readonly BacklogStatus[]
  readonly toggleStatus: (status: BacklogStatus) => void
  readonly clearStatuses: () => void
  readonly startThread: (items: readonly StartThreadItem[]) => void
  readonly projectPaths: readonly string[]
}): JSX.Element => {
  const actions = useBacklogActions()
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const selectionAnchor = useRef<number | null>(null)
  useEffect(() => {
    const availableIds = new Set(props.items.map(item => item.id))
    setSelected(current => {
      const next = new Set([...current].filter(id => availableIds.has(id)))
      return next.size === current.size ? current : next
    })
    if (selectionAnchor.current !== null && !availableIds.has(selectionAnchor.current)) selectionAnchor.current = null
  }, [props.items])
  const groups = useMemo(() => groupsOf(props.items, props.groupBy), [props.items, props.groupBy])
  const orderedIds = useMemo(() => itemsOrder(props.items, props.groupBy, props.collapsed).map(item => item.id), [props.items, props.groupBy, props.collapsed])
  const toggle = (id: number): void => {
    selectionAnchor.current = id
    setSelected(toggleBacklogSelection(selected, id))
  }
  const selectWithModifiers = (id: number, shiftKey: boolean, additive: boolean): void => {
    if (shiftKey) {
      const anchorId = selectionAnchor.current ?? id
      setSelected(extendBacklogSelection(selected, orderedIds, anchorId, id))
      return
    }
    if (additive) {
      toggle(id)
      return
    }
    selectionAnchor.current = id
    setSelected(new Set())
    props.select(id)
  }
  const clearSelection = (): void => {
    setSelected(new Set())
    selectionAnchor.current = null
  }
  const selectAllVisible = (): void => {
    if (orderedIds.length > 0 && orderedIds.every(id => selected.has(id))) {
      clearSelection()
      return
    }
    selectionAnchor.current = orderedIds[0] ?? null
    setSelected(new Set(orderedIds))
  }
  const selectedItems = useMemo(() => props.items.filter(item => selected.has(item.id)).map(startThreadItemOf), [props.items, selected])
  const startThreadForSelection = (): void => {
    props.startThread(selectedItems)
    clearSelection()
  }
  const updateSelected = (fields: { readonly status?: BacklogStatus; readonly kind?: BacklogKind; readonly pinned?: boolean }): void => {
    for (const id of selected) actions.update.mutate({ id, ...fields })
    clearSelection()
  }
  const filtering = props.statuses.length > 0
  const visibleGroups = props.groupBy === 'status' && !filtering ? groups : groups.filter(group => group.items.length > 0)
  const entries = useMemo(
    (): Entry[] =>
      visibleGroups.flatMap(group => {
        const header: Entry = { kind: 'header', key: `h:${group.key}`, group }
        if (props.collapsed.has(group.key)) return [header]
        const rows = [...group.items]
          .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.lastActivityAt - left.lastActivityAt)
          .map((item): Entry => ({ kind: 'row', key: `r:${String(item.id)}`, item }))
        return [header, ...rows]
      }),
    [visibleGroups, props.collapsed],
  )
  const scroller = useRef<HTMLDivElement>(null)
  // Only the rows in view are mounted, so a backlog of thousands scrolls like one of twenty.
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroller.current,
    estimateSize: index => (entries[index]?.kind === 'row' ? 40 : 36),
    getItemKey: index => entries[index]?.key ?? index,
    overscan: 12,
  })
  return (
    <div className="dshx:relative dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col">
      <StatusFilterBar counts={props.counts} statuses={props.statuses} toggle={props.toggleStatus} clear={props.clearStatuses} />
      <div className="dshx:flex dshx:h-10 dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-4">
        <DropdownMenu>
          <DropdownMenuTrigger className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:text-xs dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground">
            <LayersIcon className="dshx:size-3.5" /> Group: <span className="dshx:text-foreground">{groupLabels[props.groupBy]}</span>
            <ChevronDownIcon className="dshx:size-3 dshx:opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="dshx-root">
            <DropdownMenuRadioGroup value={props.groupBy} onValueChange={value => props.setGroupBy(groupByOf(value))}>
              {(['status', 'kind', 'project', 'attention'] as const).map(value => (
                <DropdownMenuRadioItem key={value} value={value} className="dshx:text-[13px]">
                  {groupLabels[value]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="dshx:ml-auto dshx:text-xs dshx:text-muted-foreground">{props.items.length} items</span>
      </div>
      <div ref={scroller} role="table" aria-label="Backlog items" className="dshx:@container dshx:min-h-0 dshx:flex-1 dshx:overflow-auto">
        <div
          role="row"
          className={cn(
            columns,
            'dshx:sticky dshx:top-0 dshx:z-20 dshx:h-8 dshx:items-center dshx:border-b dshx:border-border dshx:bg-background dshx:pr-3 dshx:text-[11px] dshx:font-medium dshx:text-muted-foreground',
          )}
        >
          <span className="dshx:flex dshx:justify-center">
            <input
              type="checkbox"
              aria-label="Select all visible items"
              checked={orderedIds.length > 0 && orderedIds.every(id => selected.has(id))}
              onChange={selectAllVisible}
              className="dshx:size-3.5 dshx:accent-[var(--color-info)]"
            />
          </span>
          <span>Item</span>
          <span>Status</span>
          <span className={roomyOnly}>Kind</span>
          <span className={wideOnly}>Project</span>
          <span className={roomyOnly}>People</span>
          <span className="dshx:text-right">Updated</span>
        </div>
        {entries.length === 0 && filtering ? (
          <div className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-2 dshx:px-4 dshx:py-20 dshx:text-center">
            <span className="dshx:text-3xl">◌</span>
            <p className="dshx:text-sm dshx:font-medium">No items match this status filter</p>
            <p className="dshx:max-w-80 dshx:text-xs dshx:text-muted-foreground">Pick another status above, or clear the filter to see everything.</p>
            <button
              type="button"
              onClick={props.clearStatuses}
              className="dshx:mt-1 dshx:rounded-full dshx:border dshx:border-border dshx:px-3 dshx:py-1 dshx:text-xs dshx:text-muted-foreground dshx:transition-colors dshx:hover:bg-accent dshx:hover:text-foreground"
            >
              Show all statuses
            </button>
          </div>
        ) : null}
        <div style={{ height: virtualizer.getTotalSize() }} className="dshx:relative">
          {virtualizer.getVirtualItems().map(virtual => {
            const entry = entries[virtual.index]
            if (entry === undefined) return null
            const groupStatus = entry.kind === 'header' ? entry.group.status : null
            return (
              <div
                key={virtual.key}
                data-index={virtual.index}
                ref={virtualizer.measureElement}
                style={{ transform: `translateY(${String(virtual.start)}px)` }}
                className="dshx:absolute dshx:inset-x-0 dshx:top-0"
              >
                {entry.kind === 'header' ? (
                  <div
                    role="rowgroup"
                    className="dshx:flex dshx:h-9 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border/60 dshx:bg-muted/50 dshx:px-2 dshx:text-[13px]"
                  >
                    <button
                      type="button"
                      aria-expanded={!props.collapsed.has(entry.group.key)}
                      aria-label={`Toggle ${entry.group.key || 'no project'}`}
                      onClick={() => {
                        const next = new Set(props.collapsed)
                        if (next.has(entry.group.key)) next.delete(entry.group.key)
                        else next.add(entry.group.key)
                        props.setCollapsed(next)
                      }}
                      className="dshx:rounded dshx:p-0.5 dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground"
                    >
                      {props.collapsed.has(entry.group.key) ? <ChevronRightIcon className="dshx:size-3.5" /> : <ChevronDownIcon className="dshx:size-3.5" />}
                    </button>
                    <span className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:font-medium">{entry.group.label}</span>
                    <span className="dshx:text-xs dshx:text-muted-foreground">{entry.group.items.length}</span>
                    {groupStatus === null ? null : (
                      <button
                        type="button"
                        aria-label={`Add to ${ItemGlyphs.statusLabels[groupStatus]}`}
                        onClick={() => props.captureInto(groupStatus)}
                        className="dshx:rounded dshx:p-0.5 dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground"
                      >
                        <PlusIcon className="dshx:size-3.5" />
                      </button>
                    )}
                  </div>
                ) : (
                  <Row
                    item={entry.item}
                    open={entry.item.id === props.openId}
                    cursor={entry.item.id === props.cursorId}
                    selected={selected.has(entry.item.id)}
                    toggle={toggle}
                    selectWithModifiers={selectWithModifiers}
                    select={id => {
                      clearSelection()
                      props.select(id)
                    }}
                    hover={props.hover}
                    startThread={props.startThread}
                    startThreadSelection={selected.has(entry.item.id) ? selectedItems : undefined}
                    projectPaths={props.projectPaths}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
      {selected.size === 0 ? null : (
        <div className="dshx:absolute dshx:bottom-4 dshx:left-1/2 dshx:z-30 dshx:flex dshx:max-w-[calc(100%-1rem)] dshx:-translate-x-1/2 dshx:flex-wrap dshx:items-center dshx:justify-center dshx:gap-1 dshx:rounded-xl dshx:border dshx:border-border dshx:bg-popover dshx:p-1 dshx:pl-3 dshx:text-[13px] dshx:shadow-lg dshx:animate-in dshx:fade-in-0 dshx:slide-in-from-bottom-2">
          <span title="Shift-click selects a range; Cmd/Ctrl-click toggles items" className="dshx:mr-2 dshx:tabular-nums">
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={startThreadForSelection}
            className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:outline-none dshx:hover:bg-accent"
          >
            <MessagesSquareIcon aria-hidden className="dshx:size-3.5" /> Start thread
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:outline-none dshx:hover:bg-accent">
              Move to <ChevronDownIcon className="dshx:size-3 dshx:opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="dshx-root">
              {BacklogItems.statuses.map(status => (
                <DropdownMenuItem key={status} className="dshx:gap-2 dshx:text-[13px]" onSelect={() => updateSelected({ status })}>
                  <ItemGlyphs.StatusIcon status={status} />
                  {ItemGlyphs.statusLabels[status]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:outline-none dshx:hover:bg-accent">
              Set kind <ChevronDownIcon className="dshx:size-3 dshx:opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="dshx-root">
              {BacklogItems.kinds.map(kind => (
                <DropdownMenuItem key={kind} className="dshx:gap-2 dshx:text-[13px]" onSelect={() => updateSelected({ kind })}>
                  <ItemGlyphs.KindIcon kind={kind} />
                  {ItemGlyphs.kindLabels[kind]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={() => updateSelected({ pinned: true })}
            className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:outline-none dshx:hover:bg-accent"
          >
            <PinIcon className="dshx:size-3.5" /> Pin
          </button>
          <button
            type="button"
            onClick={() => updateSelected({ pinned: false })}
            className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:outline-none dshx:hover:bg-accent"
          >
            Unpin
          </button>
          <button
            type="button"
            aria-label="Clear selection"
            onClick={clearSelection}
            className="dshx:rounded-md dshx:p-1.5 dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground"
          >
            <XIcon className="dshx:size-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

export type { GroupBy }
