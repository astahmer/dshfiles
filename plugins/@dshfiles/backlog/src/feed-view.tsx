import { useBacklogSelection } from './use-backlog-selection.js'
import { LinkIcon, MessageSquareIcon, PaperclipIcon, PinIcon, WandSparklesIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useLoadMore } from '@dshfiles/plugin-ui/hooks/use-load-more'
import { usePrependScrollAnchor } from '@dshfiles/plugin-ui/hooks/use-prepend-scroll-anchor'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { BacklogSummaryView } from './api.js'
import { ActorThreadLink } from './actor-thread-link.js'
import { backlogSortTime, sortBacklogItems, type BacklogSort } from './backlog-sort.js'
import type { BacklogStatus } from './item.js'
import { BacklogInlineTitle, useBacklogInlineRename } from './item-inline-title.js'
import { ItemGlyphs } from './item-glyphs.js'
import { ItemPickers } from './item-pickers.js'
import { BacklogItemMenu } from './item-actions-menu.js'
import type { StartThreadItem } from './start-thread.js'
import { StatusFilterBar } from './status-filter-bar.js'
import { BacklogText } from './item-text.js'
import { useBacklogActions } from './use-backlog-actions.js'

const DAY_MS = 86_400_000
/** Like a chat history: the newest page is mounted first, older entries appear as the scroller reaches its top. */
const PAGE = 150

const dayLabel = (time: number, now: number): string => {
  const today = new Date(now).setHours(0, 0, 0, 0)
  if (time >= today) return 'Today'
  if (time >= today - DAY_MS) return 'Yesterday'
  return new Date(time).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

/** "Agent 80c6ed moved it inbox → doing · 4 updates": the actor stays separate so it can link to its thread. */
const activityLine = (item: BacklogSummaryView): { readonly actorId: string; readonly summary: string } | null => {
  const last = item.activity.last
  if (last === null) return null
  const verb = ItemGlyphs.describeEvent(last, item.attention)
  const more = item.activity.count > 1 ? ` · ${String(item.activity.count)} updates` : ''
  return { actorId: last.actor, summary: `${verb}${more}` }
}

const Chip = (props: { readonly children: ReactNode; readonly className?: string }): JSX.Element => (
  <span
    className={cn(
      'dshx:inline-flex dshx:h-5 dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-md dshx:border dshx:border-border dshx:px-1.5 dshx:text-[11px] dshx:text-muted-foreground',
      props.className,
    )}
  >
    {props.children}
  </span>
)

const FeedEntry = (props: {
  readonly item: BacklogSummaryView
  readonly open: boolean
  readonly selection: ReturnType<typeof useBacklogSelection>
  readonly cursor: boolean
  readonly select: (id: number) => void
  readonly startThread: (items: readonly StartThreadItem[]) => void
  readonly projectPaths: readonly string[]
  readonly triageOff: boolean
  readonly openThread: (sessionId: string) => void
}): JSX.Element => {
  const actions = useBacklogActions()
  const item = props.item
  const author = item.actors.find(actor => actor.role === 'owner')?.id ?? item.actors[0]?.id
  const activity = activityLine(item)
  const closed = item.status === 'done' || item.status === 'dropped'
  const rename = useBacklogInlineRename(() => props.select(item.id))
  return (
    <BacklogItemMenu
      item={item}
      selection={props.selection.selected.has(item.id) ? props.selection.selection : undefined}
      clearSelection={props.selection.clear}
      projectPaths={props.projectPaths}
      update={input => actions.update.mutate(input)}
      triage={id => actions.triage.mutate(id)}
      triageOff={props.triageOff}
      startThread={props.startThread}
      openItem={props.select}
    >
      <article
        tabIndex={-1}
        aria-label={`Item b:${String(item.id)}`}
        data-selected={props.selection.selected.has(item.id) || undefined}
        onClick={event => {
          if (props.selection.click(item.id, event)) return
          if (!rename.renaming) rename.openSoon()
        }}
        onDoubleClick={rename.renameOnDoubleClick}
        className={cn(
          'dshx:group/entry dshx:relative dshx:flex dshx:cursor-default dshx:gap-3 dshx:rounded-lg dshx:px-3 dshx:py-2.5 dshx:transition-colors dshx:duration-100 dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-info/50',
          props.selection.selected.has(item.id) || props.open ? 'dshx:bg-accent/70' : props.cursor ? 'dshx:bg-accent/45' : 'dshx:hover:bg-accent/35',
        )}
      >
        {props.selection.selected.has(item.id) ? (
          <span
            aria-hidden="true"
            className="dshx:pointer-events-none dshx:absolute dshx:-left-2 dshx:top-1/2 dshx:flex dshx:size-4 dshx:-translate-y-1/2 dshx:items-center dshx:justify-center dshx:rounded-[3px] dshx:border dshx:border-info dshx:bg-info dshx:text-[11px] dshx:text-info-foreground"
            data-backlog-selection-indicator=""
          >
            ✓
          </span>
        ) : null}
        <ItemGlyphs.ActorAvatar actorId={author} className="dshx:mt-0.5 dshx:size-7 dshx:text-[11px] dshx:ring-0" />
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
          <div className="dshx:flex dshx:items-baseline dshx:gap-2 dshx:text-xs">
            <span className="dshx:font-medium dshx:text-foreground">{ItemGlyphs.actorName(author)}</span>
            <span className="dshx:text-muted-foreground">{new Date(item.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="dshx:font-mono! dshx:text-[11px] dshx:text-muted-foreground">b:{item.id}</span>
          </div>
          <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
            <span onClick={event => event.stopPropagation()}>
              <ItemPickers.Status id={item.id} status={item.status} onPick={status => actions.update.mutate({ id: item.id, status })} />
            </span>
            {item.kind === 'task' ? null : <ItemGlyphs.KindIcon kind={item.kind} />}
            {rename.renaming ? (
              <BacklogInlineTitle
                id={item.id}
                title={item.title}
                cancel={rename.endRename}
                className="dshx:h-6 dshx:min-w-0 dshx:flex-1 dshx:border-0 dshx:bg-transparent dshx:p-0 dshx:text-sm dshx:font-medium dshx:shadow-none dshx:focus-visible:ring-1"
              />
            ) : (
              <BacklogText
                text={item.title}
                className={cn(
                  'dshx:min-w-0 dshx:flex-1 dshx:cursor-text dshx:truncate dshx:text-sm dshx:font-medium dshx:[&>div]:truncate dshx:[&>div]:text-sm! dshx:[&>div]:leading-tight! dshx:[&>div]:font-medium! dshx:[&>div]:text-foreground! dshx:[&>div>p]:my-0 dshx:[&>div>p]:truncate',
                  closed &&
                    'dshx:text-muted-foreground dshx:line-through dshx:decoration-muted-foreground/40 dshx:[&>div]:text-muted-foreground! dshx:[&>div]:line-through',
                )}
              />
            )}
          </div>
          {item.preview === '' ? null : (
            <BacklogText
              text={item.preview}
              className="dshx:line-clamp-2 dshx:text-[13px] dshx:leading-relaxed dshx:text-muted-foreground dshx:[&>div]:line-clamp-2 dshx:[&>div]:text-[13px]! dshx:[&>div]:leading-relaxed! dshx:[&>div]:text-muted-foreground! dshx:[&>div>p]:my-0"
            />
          )}
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5">
            <ItemGlyphs.AttentionBadge attention={item.attention} />
            {item.proposal === null ? null : (
              <Chip className="dshx:border-violet/40 dshx:text-violet">
                <WandSparklesIcon className="dshx:size-3" /> Suggestion
              </Chip>
            )}
            {item.project === null ? null : (
              <Chip>
                <ItemGlyphs.ProjectLabel project={item.project} />
              </Chip>
            )}
            {item.tags.map(tag => (
              <Chip key={tag}>#{tag}</Chip>
            ))}
            {item.attachments.length === 0 ? null : (
              <Chip>
                <PaperclipIcon className="dshx:size-3" />
                {item.attachments.length}
              </Chip>
            )}
            {item.links.length === 0 ? null : (
              <Chip>
                <LinkIcon className="dshx:size-3" />
                {item.links.length}
              </Chip>
            )}
            {item.activity.comments === 0 ? null : (
              <Chip>
                <MessageSquareIcon className="dshx:size-3" />
                {item.activity.comments}
              </Chip>
            )}
            {item.freshness === 'fresh' ? null : <Chip className={cn(item.freshness === 'stale' && 'dshx:text-warning')}>{item.freshness}</Chip>}
          </div>
          {activity === null ? null : (
            <p className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-[11px] dshx:text-muted-foreground">
              <span aria-hidden className="dshx:h-px dshx:w-3 dshx:shrink-0 dshx:bg-border" />
              <span className="dshx:min-w-0 dshx:truncate">
                <ActorThreadLink actorId={activity.actorId} openThread={props.openThread} /> <span>{activity.summary}</span>
              </span>
              <span className="dshx:shrink-0">· {ItemGlyphs.ago(item.lastActivityAt)}</span>
            </p>
          )}
        </div>
        <div
          onClick={event => event.stopPropagation()}
          className="dshx:absolute dshx:-top-3 dshx:right-3 dshx:flex dshx:items-center dshx:gap-0.5 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-popover dshx:p-0.5 dshx:opacity-0 dshx:shadow-sm dshx:transition-opacity dshx:group-hover/entry:opacity-100"
        >
          <button
            type="button"
            aria-label={item.pinned ? 'Unpin' : 'Pin'}
            onClick={() => actions.update.mutate({ id: item.id, pinned: !item.pinned })}
            className={cn(
              'dshx:rounded-md dshx:p-1 dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground',
              item.pinned && 'dshx:text-warning',
            )}
          >
            <PinIcon className={cn('dshx:size-3.5', item.pinned && 'dshx:fill-current')} />
          </button>
          {props.triageOff ? null : (
            <button
              type="button"
              aria-label="Run triage"
              onClick={() => actions.triage.mutate(item.id)}
              className="dshx:rounded-md dshx:p-1 dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground"
            >
              <WandSparklesIcon className="dshx:size-3.5" />
            </button>
          )}
        </div>
      </article>
    </BacklogItemMenu>
  )
}

const selectionLabel = (statuses: readonly BacklogStatus[]): string => {
  const labels = statuses.map(status => ItemGlyphs.statusLabels[status].toLowerCase())
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`
}

/**
 * The Discord channel this replaces: one entry per item in order of last activity, newest at the bottom beside the
 * composer, so touching an item bumps it down and idle ones scroll away. Pinned items stay in a strip on top.
 */
export const FeedView = (props: {
  readonly items: readonly BacklogSummaryView[]
  readonly sort: BacklogSort
  readonly counts: Record<BacklogStatus, number>
  readonly statuses: readonly BacklogStatus[]
  readonly toggleStatus: (status: BacklogStatus) => void
  readonly clearStatuses: () => void
  readonly openId: number | null
  readonly cursorId: number | null
  readonly select: (id: number) => void
  readonly loaded: boolean
  readonly now: number
  readonly startThread: (items: readonly StartThreadItem[]) => void
  readonly projectPaths: readonly string[]
  readonly triageOff: boolean
  readonly openThread: (sessionId: string) => void
}): JSX.Element => {
  const now = props.now
  const menuActions = useBacklogActions()
  const scroller = useRef<HTMLDivElement | null>(null)
  const atBottom = useRef(true)
  const ordered = useMemo(
    () =>
      sortBacklogItems(
        props.items.filter(item => !item.pinned),
        props.sort,
        'ascending',
      ),
    [props.items, props.sort],
  )
  const [shown, setShown] = useState(PAGE)
  const visible = ordered.slice(-shown)
  const hidden = ordered.length - visible.length
  const captureOlderAnchor = usePrependScrollAnchor({ root: scroller, pageCount: shown, scope: JSON.stringify(props.statuses) })
  const olderSentinel = useLoadMore({
    enabled: hidden > 0,
    resetKey: shown,
    onLoadMore: () => {
      captureOlderAnchor()
      setShown(current => current + PAGE)
    },
    root: scroller,
    rootMargin: '500px 0px 0px 0px',
  })
  const pinned = props.items.filter(item => item.pinned)
  const selection = useBacklogSelection({ items: [...pinned, ...visible], openId: props.openId, scope: JSON.stringify(props.statuses) })
  const lastId = ordered.at(-1)?.id

  useLayoutEffect(() => {
    const element = scroller.current
    if (element !== null && atBottom.current) element.scrollTop = element.scrollHeight
  }, [ordered.length, lastId])
  useEffect(() => {
    const element = scroller.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [props.loaded])

  const renderVisibleEntry = (item: BacklogSummaryView, index: number): JSX.Element => {
    const itemDate = backlogSortTime(item, props.sort)
    const label = dayLabel(itemDate, now)
    const previous = visible[index - 1]
    const separator = previous === undefined || dayLabel(backlogSortTime(previous, props.sort), now) !== label
    return (
      <div key={item.id}>
        {separator ? (
          <div role="separator" className="dshx:my-3 dshx:flex dshx:items-center dshx:gap-3 dshx:px-3">
            <span className="dshx:h-px dshx:flex-1 dshx:bg-border" />
            <span className="dshx:text-[11px] dshx:font-medium dshx:text-muted-foreground">{label}</span>
            <span className="dshx:h-px dshx:flex-1 dshx:bg-border" />
          </div>
        ) : null}
        <FeedEntry
          item={item}
          selection={selection}
          open={item.id === props.openId}
          cursor={item.id === props.cursorId}
          select={props.select}
          startThread={props.startThread}
          projectPaths={props.projectPaths}
          triageOff={props.triageOff}
          openThread={props.openThread}
        />
      </div>
    )
  }

  return (
    <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col">
      <StatusFilterBar counts={props.counts} statuses={props.statuses} toggle={props.toggleStatus} clear={props.clearStatuses} />
      {pinned.length === 0 ? null : (
        <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:overflow-x-auto dshx:border-b dshx:border-border dshx:px-4 dshx:py-2">
          <PinIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:fill-current dshx:text-warning" />
          {pinned.map(item => (
            <BacklogItemMenu
              key={item.id}
              item={item}
              selection={selection.selected.has(item.id) ? selection.selection : undefined}
              clearSelection={selection.clear}
              projectPaths={props.projectPaths}
              update={input => menuActions.update.mutate(input)}
              triage={id => menuActions.triage.mutate(id)}
              triageOff={props.triageOff}
              startThread={props.startThread}
              openItem={props.select}
            >
              <button
                type="button"
                onClick={event => {
                  if (!selection.click(item.id, event)) props.select(item.id)
                }}
                data-selected={selection.selected.has(item.id) || undefined}
                className="dshx:data-selected:bg-accent/70 dshx:flex dshx:h-7 dshx:max-w-64 dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-border dshx:bg-card dshx:px-2 dshx:text-xs dshx:transition-colors dshx:hover:bg-accent"
              >
                <ItemGlyphs.StatusIcon status={item.status} />
                <span className="dshx:truncate">{item.title}</span>
              </button>
            </BacklogItemMenu>
          ))}
        </div>
      )}
      <div
        ref={scroller}
        role="feed"
        aria-label="Backlog feed"
        onScroll={event => {
          const element = event.currentTarget
          atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
        }}
        className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto"
      >
        <div className="dshx:mx-auto dshx:flex dshx:min-h-full dshx:max-w-4xl dshx:flex-col dshx:justify-end dshx:px-3 dshx:pt-6 dshx:pb-3">
          {props.loaded && props.items.length === 0 ? (
            props.statuses.length === 0 ? (
              <div className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-2 dshx:py-20 dshx:text-center">
                <span className="dshx:text-3xl">✦</span>
                <p className="dshx:text-sm dshx:font-medium">Your backlog starts here</p>
                <p className="dshx:max-w-80 dshx:text-xs dshx:text-muted-foreground">
                  Type anything below like a message. Kinds, tags and links are picked up for you; idle things sink on their own.
                </p>
              </div>
            ) : (
              <div className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-2 dshx:py-20 dshx:text-center">
                <span className="dshx:text-3xl">◌</span>
                <p className="dshx:text-sm dshx:font-medium">No {selectionLabel(props.statuses)} items</p>
                <p className="dshx:max-w-80 dshx:text-xs dshx:text-muted-foreground">Pick another status above, or clear the filter to see everything.</p>
                <button
                  type="button"
                  onClick={props.clearStatuses}
                  className="dshx:mt-1 dshx:rounded-full dshx:border dshx:border-border dshx:px-3 dshx:py-1 dshx:text-xs dshx:text-muted-foreground dshx:transition-colors dshx:hover:bg-accent dshx:hover:text-foreground"
                >
                  Show all statuses
                </button>
              </div>
            )
          ) : null}
          <div key="older-sentinel" ref={olderSentinel} aria-hidden="true" style={{ flex: '0 0 1px', height: 1 }} />
          {visible.map((item, index) => renderVisibleEntry(item, index))}
        </div>
      </div>
    </div>
  )
}
