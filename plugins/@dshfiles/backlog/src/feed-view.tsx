import { useBacklogSelection } from './use-backlog-selection.js'
import { EmptyState } from '@dshfiles/plugin-ui/components/page'
import { LinkIcon, MessageSquareIcon, PaperclipIcon, PinIcon, WandSparklesIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { useLoadMore } from '@dshfiles/plugin-ui/hooks/use-load-more'
import { usePrependScrollAnchor } from '@dshfiles/plugin-ui/hooks/use-prepend-scroll-anchor'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { BacklogSummaryView } from './api.js'
import { ActorThreadLink } from './actor-thread-link.js'
import { backlogSortTime, sortBacklogItems, type BacklogSort } from './backlog-sort.js'
import type { BacklogStatus } from './item.js'
import { BacklogInlineTitle, useBacklogInlineRename } from './item-inline-title.js'
import { imageTitleFallback } from './image-title.js'
import { ItemGlyphs } from './item-glyphs.js'
import { ItemPickers } from './item-pickers.js'
import { BacklogItemMenu } from './item-actions-menu.js'
import type { StartThreadItem } from './start-thread.js'
import { BacklogText } from './item-text.js'
import { useBacklogActions } from './use-backlog-actions.js'
import { BacklogReference } from './backlog-reference.js'
import { BacklogMentionHandle } from './backlog-mention-handle.js'
import { FeedLook } from './feed-look.js'
import { formatClockTime } from '@dshfiles/plugin-ui/lib/format-clock-time'

const DAY_MS = 86_400_000
/** Like a chat history: the newest page is mounted first, older entries appear as the scroller reaches its top. */
const PAGE = 150

const dayLabel = (time: number, now: number): string => {
  const today = new Date(now).setHours(0, 0, 0, 0)
  if (time >= today) return 'Today'
  if (time >= today - DAY_MS) return 'Yesterday'
  return new Date(time).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

/** The kit clock, so a row's time reads like every other time on screen (council round 5, D4). */
const rowTime = (time: number): string => formatClockTime(time)

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
      'dshx:inline-flex dshx:h-5 dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-md dshx:border dshx:border-border dshx:px-1.5 dshx:text-2xs dshx:text-muted-foreground',
      props.className,
    )}
  >
    {props.children}
  </span>
)

/**
 * When the item was captured, and its `b:` id: an 11 px tabular run label in the row's leading gutter, so a run of
 * same-minute rows reads as one labelled run instead of a time on one row and none on the next (council round 6, D3).
 */
export const FeedEntryTime = (props: {
  readonly item: { readonly id: number; readonly ref?: string | undefined; readonly title: string; readonly createdAt: number }
  /** The row above shows the same time: this row keeps it as a handle that shows on hover or focus (round 5, D4). */
  readonly timeShownAbove?: boolean
}): JSX.Element => (
  <span
    data-feed-entry-gutter=""
    className="dshx:flex dshx:min-w-0 dshx:items-center dshx:text-2xs dshx:whitespace-nowrap dshx:text-muted-foreground dshx:tabular-nums"
  >
    {/* The id is a reference, not a label: it shows on hover, and the time stays the drag handle that mentions it. */}
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-feed-entry-time=""
          className={cn(
            props.timeShownAbove === true &&
              'dshx:opacity-0 dshx:transition-opacity dshx:group-hover/entry:opacity-100 dshx:focus-within:opacity-100 dshx:pointer-coarse:opacity-100',
          )}
        >
          <BacklogMentionHandle item={props.item} className="dshx:font-sans!">
            {rowTime(props.item.createdAt)}
          </BacklogMentionHandle>
        </span>
      </TooltipTrigger>
      <TooltipContent>{BacklogReference.labelOf(props.item)}</TooltipContent>
    </Tooltip>
  </span>
)

/**
 * Who captured the item: trailing muted meta, so the row leads with the item itself. Left out when every row has the
 * same author: "You" down the whole page says nothing (council round 2, D2).
 */
export const FeedEntryAuthor = (props: { readonly author: string | undefined }): JSX.Element => (
  <span data-feed-entry-meta="" className="dshx:min-w-0 dshx:shrink-0 dshx:truncate dshx:text-2xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">
    {ItemGlyphs.actorName(props.author)}
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
  /** False when every row in the feed has the same author: the avatar would repeat one face down the page. */
  readonly showAuthor: boolean
  /** A tag's fixed tone (`FeedLook.tagTone`). */
  readonly tagTone: (tag: string) => string
  readonly timeShownAbove: boolean
}): JSX.Element => {
  const actions = useBacklogActions()
  const item = props.item
  const author = item.actors.find(actor => actor.role === 'owner')?.id ?? item.actors[0]?.id
  const activity = activityLine(item)
  const closed = item.status === 'done' || item.status === 'dropped'
  const rename = useBacklogInlineRename(() => props.select(item.id))
  const inlineTag = FeedLook.inlineTag(item)
  const tagChip = (tag: string): JSX.Element => (
    <span key={tag} className={cn(FeedLook.TAG_CHIP, props.tagTone(tag))}>
      <span className="dshx-project-mark-letters">#{tag}</span>
    </span>
  )
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
        aria-label={`Item ${BacklogReference.labelOf(item)}`}
        data-selected={props.selection.selected.has(item.id) || undefined}
        onClick={event => {
          if (props.selection.click(item.id, event)) return
          if (!rename.renaming) rename.openSoon()
        }}
        onDoubleClick={rename.renameOnDoubleClick}
        className={cn(
          'dshx:group/entry dshx:relative dshx:flex dshx:cursor-default dshx:gap-3 dshx:min-h-[44px] dshx:rounded-lg dshx:px-2 dshx:py-[10px] dshx:transition-colors dshx:duration-100 dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-info/50',
          props.selection.selected.has(item.id) || props.open ? 'dshx:bg-accent/70' : props.cursor ? 'dshx:bg-accent/45' : 'dshx:hover:bg-accent/35',
        )}
      >
        {props.selection.selected.has(item.id) ? (
          <span
            aria-hidden="true"
            className="dshx:pointer-events-none dshx:absolute dshx:-left-2 dshx:top-1/2 dshx:flex dshx:size-4 dshx:-translate-y-1/2 dshx:items-center dshx:justify-center dshx:rounded-xs dshx:border dshx:border-info dshx:bg-info dshx:text-2xs dshx:text-info-foreground"
            data-backlog-selection-indicator=""
          >
            ✓
          </span>
        ) : null}
        {props.showAuthor ? <ItemGlyphs.ActorAvatar actorId={author} className="dshx:mt-0.5 dshx:size-7 dshx:text-2xs dshx:ring-0" /> : null}
        {/*
         * One grid for every row (council round 2, D2): a 52 px time gutter (council round 6, D3), the 30 px status
         * menu seat (glyph and chevron, council round 9, D2), title, then the author when rows differ; the rest sits
         * under the title.
         */}
        <div className="dshx:grid dshx:min-w-0 dshx:flex-1 dshx:grid-cols-[52px_30px_minmax(0,1fr)_auto] dshx:content-center dshx:items-center dshx:gap-x-2.5 dshx:gap-y-1">
          <FeedEntryTime item={item} timeShownAbove={props.timeShownAbove} />
          <span onClick={event => event.stopPropagation()} className="dshx:flex dshx:w-[30px] dshx:justify-center">
            <ItemPickers.Status
              itemLabel={BacklogReference.labelOf(item)}
              status={item.status}
              stale={ItemGlyphs.isStale(item.freshness)}
              onPick={status => actions.update.mutate({ id: item.id, status })}
            />
          </span>
          <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
            {item.kind === 'task' ? null : <ItemGlyphs.KindIcon kind={item.kind} />}
            {rename.renaming ? (
              <BacklogInlineTitle
                id={item.id}
                value={item.title}
                cancel={rename.endRename}
                className="dshx:h-6 dshx:min-w-0 dshx:flex-1 dshx:border-0 dshx:bg-transparent dshx:p-0 dshx:text-sm dshx:font-medium dshx:shadow-none dshx:focus-visible:ring-1"
              />
            ) : (
              <BacklogText
                text={imageTitleFallback(item.title)}
                className={cn(
                  // The native compact Markdown root (`> div > div`) sets 13 px tertiary text of its own: the title restyles it.
                  // With an inline tag the title hugs its text, so the tag follows it instead of waiting at the far edge.
                  inlineTag === null ? 'dshx:flex-1' : 'dshx:flex-initial',
                  'dshx:min-w-0 dshx:cursor-text dshx:truncate dshx:text-base dshx:font-medium dshx:[&>div]:truncate dshx:[&>div]:font-medium! dshx:[&>div>div]:text-base! dshx:[&>div>div]:leading-5! dshx:[&>div>div]:text-foreground! dshx:[&>div_p]:my-0 dshx:[&>div_p]:truncate',
                  closed &&
                    'dshx:text-muted-foreground dshx:line-through dshx:decoration-muted-foreground/40 dshx:[&>div>div]:text-muted-foreground! dshx:[&>div]:line-through',
                )}
              />
            )}
            {inlineTag === null ? null : tagChip(inlineTag)}
          </div>
          {props.showAuthor ? <FeedEntryAuthor author={author} /> : null}
          {item.preview === '' ? null : (
            <BacklogText
              text={item.preview}
              className="dshx:col-span-2 dshx:col-start-3 dshx:line-clamp-2 dshx:text-sm dshx:leading-relaxed dshx:text-muted-foreground dshx:[&>div]:line-clamp-2 dshx:[&>div>div]:text-sm! dshx:[&>div>div]:leading-relaxed! dshx:[&>div>div]:text-muted-foreground! dshx:[&>div_p]:my-0"
            />
          )}
          <div data-feed-entry-chips="" className="dshx:col-span-2 dshx:col-start-3 dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:empty:hidden">
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
            {inlineTag === null ? item.tags.map(tagChip) : null}
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
            <p className="dshx:col-span-2 dshx:col-start-3 dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-2xs dshx:text-muted-foreground">
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
          className="dshx:absolute dshx:-top-3 dshx:right-3 dshx:flex dshx:items-center dshx:gap-0.5 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-popover dshx:p-0.5 dshx:opacity-0 dshx:shadow-sm dshx:transition-opacity dshx:group-hover/entry:opacity-100 dshx:@max-pane-narrow:hidden"
        >
          <button
            type="button"
            aria-label={item.pinned ? 'Unpin' : 'Pin'}
            onClick={() => actions.update.mutate({ id: item.id, pinned: !item.pinned })}
            className={cn(
              'dshx:rounded-md dshx:p-1 dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground',
              item.pinned && 'dshx:text-foreground',
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
  /** The status filter, picked in the toolbar's Filter menu; the feed only says when it hides everything. */
  readonly statuses: readonly BacklogStatus[]
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
  const showAuthor = FeedLook.authorsDiffer([...pinned, ...ordered])
  /** Each row's printed time; a run of same-minute rows under one divider shows it once (council round 5, D4). */
  const times = visible.map(item => rowTime(item.createdAt))

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
      <div key={item.id} className={cn(FeedLook.startsTimeGroup(times, index, separator) && 'dshx:mt-2')}>
        {/* Start-aligned on the rows' glyph edge, the rule running after it (council round 5, D4). */}
        {separator ? (
          <div role="separator" className="dshx:my-2 dshx:flex dshx:items-center dshx:gap-3 dshx:px-2">
            <span className="dshx:text-2xs dshx:font-medium dshx:text-muted-foreground dshx:tabular-nums">{label}</span>
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
          showAuthor={showAuthor}
          tagTone={FeedLook.tagTone}
          timeShownAbove={!separator && FeedLook.timeShownAbove(times, index)}
        />
      </div>
    )
  }

  return (
    <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col">
      {pinned.length === 0 ? null : (
        <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:overflow-x-auto dshx:border-b dshx:border-border dshx:px-4 dshx:py-2">
          <PinIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:fill-current dshx:text-foreground" />
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
                <span className="dshx:truncate">{imageTitleFallback(item.title)}</span>
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
        {/* Rows sit at the card's 12 px padding (4 px gutter + 8 px row inset), on the page header's edge. */}
        <div className="dshx:flex dshx:min-h-full dshx:flex-col dshx:justify-start dshx:p-1">
          {props.loaded && props.items.length === 0 ? (
            props.statuses.length === 0 ? (
              <EmptyState className="dshx:py-20">
                Your backlog starts here. Type anything below like a message; kinds, tags and links are picked up for you.
              </EmptyState>
            ) : (
              <EmptyState className="dshx:py-20" action={{ label: 'Show all statuses', onSelect: props.clearStatuses }}>
                No {selectionLabel(props.statuses)} items. Pick another status above, or clear the filter to see everything.
              </EmptyState>
            )
          ) : null}
          <div key="older-sentinel" ref={olderSentinel} aria-hidden="true" style={{ flex: '0 0 1px', height: 1 }} />
          {visible.map((item, index) => renderVisibleEntry(item, index))}
        </div>
      </div>
    </div>
  )
}
