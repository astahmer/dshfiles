import { LinkIcon, LoaderCircleIcon, MessageSquareIcon, PlusIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, type PointerEvent as ReactPointerEvent } from 'react'

import type { BacklogSummaryView } from './api.js'
import type { BacklogStatus } from './item.js'
import { BacklogInlineTitle, useBacklogInlineRename } from './item-inline-title.js'
import { ItemGlyphs } from './item-glyphs.js'
import { BacklogText } from './item-text.js'
import { ItemPickers } from './item-pickers.js'
import { BacklogItemMenu } from './item-actions-menu.js'
import type { StartThreadItem } from './start-thread.js'
import { useBacklogActions } from './use-backlog-actions.js'
import { withViewTransition } from './view-transition.js'

const boardStatuses: readonly BacklogStatus[] = ['inbox', 'todo', 'doing', 'done', 'dropped']
/** Cards mounted per column before scrolling near the end reveals another batch. */
const COLUMN_PAGE = 30

type Drag = { readonly id: number; readonly x: number; readonly y: number; readonly offsetX: number; readonly offsetY: number; readonly width: number }

/** The card's state line, as the video's footer: what it is doing now, not its metadata. */
const StateLine = (props: { readonly item: BacklogSummaryView }): JSX.Element => {
  const item = props.item
  if (item.attention !== 'none') return <ItemGlyphs.AttentionBadge attention={item.attention} />
  if (item.status === 'doing')
    return (
      <span className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-[11px] dshx:text-muted-foreground">
        <LoaderCircleIcon aria-hidden className="dshx:size-3 dshx:animate-spin dshx:text-info dshx:[animation-duration:2.4s]" />
        {ItemGlyphs.ago(item.lastActivityAt)}
      </span>
    )
  if (item.status === 'done')
    return (
      <span className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-[11px] dshx:text-muted-foreground">
        <span aria-hidden className="dshx:size-1.5 dshx:rounded-full dshx:bg-success" /> Done {ItemGlyphs.ago(item.lastActivityAt)}
      </span>
    )
  return <span className="dshx:text-[11px] dshx:text-muted-foreground">{ItemGlyphs.ago(item.lastActivityAt)}</span>
}

const CardFace = (props: {
  readonly item: BacklogSummaryView
  readonly onPickStatus?: (status: BacklogStatus) => void
  readonly renaming?: boolean
  readonly onRenameDone?: () => void
}): JSX.Element => {
  const item = props.item
  return (
    <>
      <div className="dshx:flex dshx:items-start dshx:gap-2">
        {item.kind === 'task' ? null : (
          <span className="dshx:mt-0.5">
            <ItemGlyphs.KindIcon kind={item.kind} />
          </span>
        )}
        {props.renaming === true && props.onRenameDone !== undefined ? (
          <BacklogInlineTitle
            id={item.id}
            title={item.title}
            cancel={props.onRenameDone}
            className="dshx:h-6 dshx:min-w-0 dshx:flex-1 dshx:border-0 dshx:bg-transparent dshx:p-0 dshx:text-[13px] dshx:font-medium dshx:shadow-none dshx:focus-visible:ring-1"
          />
        ) : (
          <BacklogText
            text={item.title}
            className="dshx:line-clamp-2 dshx:min-w-0 dshx:flex-1 dshx:text-[13px] dshx:leading-snug dshx:font-medium dshx:text-foreground dshx:[&>div]:line-clamp-2 dshx:[&>div]:text-[13px]! dshx:[&>div]:leading-snug! dshx:[&>div]:font-medium! dshx:[&>div]:text-foreground! dshx:[&>div>p]:my-0"
          />
        )}
        {props.onPickStatus === undefined ? null : (
          <span
            className="dshx:-mt-1 dshx:-mr-1.5 dshx:opacity-0 dshx:transition-opacity dshx:group-hover/card:opacity-100"
            onPointerDown={event => event.stopPropagation()}
          >
            <ItemPickers.Status id={item.id} status={item.status} onPick={props.onPickStatus} />
          </span>
        )}
      </div>
      {item.preview === '' ? null : (
        <BacklogText
          text={item.preview}
          className="dshx:line-clamp-2 dshx:text-xs dshx:leading-relaxed dshx:text-muted-foreground dshx:[&>div]:line-clamp-2 dshx:[&>div]:text-xs! dshx:[&>div]:leading-relaxed! dshx:[&>div]:text-muted-foreground! dshx:[&>div>p]:my-0"
        />
      )}
      <div className="dshx:flex dshx:items-center dshx:gap-2">
        <StateLine item={item} />
        <span className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-2 dshx:text-[11px] dshx:text-muted-foreground">
          {item.project === null ? null : <ItemGlyphs.ProjectLabel project={item.project} className="dshx:max-w-24" />}
          {item.links.length === 0 ? null : (
            <span className="dshx:flex dshx:items-center dshx:gap-0.5">
              <LinkIcon aria-hidden className="dshx:size-3" />
              {item.links.length}
            </span>
          )}
          {item.activity.comments === 0 ? null : (
            <span className="dshx:flex dshx:items-center dshx:gap-0.5">
              <MessageSquareIcon aria-hidden className="dshx:size-3" />
              {item.activity.comments}
            </span>
          )}
          <span className="dshx:font-mono!">b:{item.id}</span>
        </span>
      </div>
    </>
  )
}

const cardClass =
  'dshx:group/card dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-xl dshx:border dshx:bg-card dshx:p-3 dshx:shadow-xs dshx:transition-[border-color,box-shadow,opacity] dshx:duration-150 dshx:select-none'

const BoardCard = (props: {
  readonly item: BacklogSummaryView
  readonly openId: number | null
  readonly open: (id: number) => void
  readonly startDrag: (event: ReactPointerEvent<HTMLElement>, item: BacklogSummaryView, open: () => void) => void
  readonly pickStatus: (id: number, status: BacklogStatus) => void
  readonly startThread: (items: readonly StartThreadItem[]) => void
  readonly projectPaths: readonly string[]
  readonly dragging: boolean
}): JSX.Element => {
  const actions = useBacklogActions()
  const item = props.item
  const rename = useBacklogInlineRename(() => props.open(item.id))
  return (
    <BacklogItemMenu
      item={item}
      projectPaths={props.projectPaths}
      update={input => actions.update.mutate(input)}
      triage={id => actions.triage.mutate(id)}
      startThread={props.startThread}
      openItem={props.open}
    >
      <article
        aria-label={`Card b:${String(item.id)}`}
        onPointerDown={event => props.startDrag(event, item, rename.openSoon)}
        onDoubleClick={rename.renameOnDoubleClick}
        style={{ viewTransitionName: `backlog-item-${String(item.id)}` }}
        className={cn(
          cardClass,
          'dshx:cursor-grab dshx:hover:border-input dshx:hover:shadow-sm',
          item.id === props.openId ? 'dshx:border-info/60 dshx:ring-1 dshx:ring-info/25' : 'dshx:border-border',
          props.dragging && 'dshx:opacity-30',
        )}
      >
        <CardFace item={item} renaming={rename.renaming} onRenameDone={rename.endRename} onPickStatus={status => props.pickStatus(item.id, status)} />
      </article>
    </BacklogItemMenu>
  )
}

/**
 * Columns by status. A click opens the item's detail beside the board; dragging moves it, and the View Transition
 * lets it glide into the new column. Every column is a drop target.
 */
export const BoardView = (props: {
  readonly items: readonly BacklogSummaryView[]
  readonly openId: number | null
  readonly open: (id: number) => void
  readonly captureInto: (status: BacklogStatus) => void
  readonly startThread: (items: readonly StartThreadItem[]) => void
  readonly projectPaths: readonly string[]
}): JSX.Element => {
  const actions = useBacklogActions()
  const [drag, setDrag] = useState<Drag | null>(null)
  const [over, setOver] = useState<BacklogStatus | null>(null)
  const [pages, setPages] = useState<Partial<Record<BacklogStatus, number>>>({})
  const dragged = drag === null ? undefined : props.items.find(item => item.id === drag.id)

  const move = (id: number, status: BacklogStatus): void => {
    withViewTransition(() => actions.patch({ id, status }))
    actions.update.mutate({ id, status })
  }

  const columnAt = (x: number, y: number): BacklogStatus | null => {
    const value = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-backlog-column]')?.dataset['backlogColumn']
    return boardStatuses.find(status => status === value) ?? null
  }

  const startDrag = (event: ReactPointerEvent<HTMLElement>, item: BacklogSummaryView, open: () => void): void => {
    if (event.button !== 0 || (event.target instanceof HTMLElement && event.target.closest('button') !== null)) return
    const card = event.currentTarget.getBoundingClientRect()
    const origin = { x: event.clientX, y: event.clientY }
    let started = false
    const onMove = (moveEvent: PointerEvent): void => {
      if (!started && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 4) return
      started = true
      setDrag({ id: item.id, x: moveEvent.clientX, y: moveEvent.clientY, offsetX: origin.x - card.left, offsetY: origin.y - card.top, width: card.width })
      setOver(columnAt(moveEvent.clientX, moveEvent.clientY))
    }
    const onUp = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDrag(null)
      setOver(null)
      if (!started) {
        open()
        return
      }
      const target = columnAt(upEvent.clientX, upEvent.clientY)
      if (target !== null && target !== item.status) move(item.id, target)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className={cn('dshx:flex dshx:h-full dshx:min-h-0 dshx:gap-3 dshx:overflow-x-auto dshx:px-4 dshx:py-4', drag !== null && 'dshx:cursor-grabbing')}>
      {boardStatuses.map(status => {
        const column = props.items.filter(item => item.status === status).sort((left, right) => right.lastActivityAt - left.lastActivityAt)
        const target = over === status && dragged?.status !== status
        return (
          <section
            key={status}
            data-backlog-column={status}
            aria-label={`${ItemGlyphs.statusLabels[status]} column`}
            className={cn(
              'dshx:flex dshx:min-h-0 dshx:max-w-80 dshx:min-w-64 dshx:flex-1 dshx:flex-col dshx:rounded-2xl dshx:p-1.5 dshx:transition-[background-color,box-shadow] dshx:duration-150',
              target ? 'dshx:bg-info/10 dshx:ring-1 dshx:ring-info/40' : 'dshx:bg-muted/45',
            )}
          >
            <header className="dshx:flex dshx:h-8 dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:px-2">
              <ItemGlyphs.StatusIcon status={status} />
              <h3 className="dshx:text-[11px] dshx:font-semibold dshx:uppercase dshx:tracking-wider dshx:text-muted-foreground">
                {ItemGlyphs.statusLabels[status]}
              </h3>
              <span className="dshx:rounded-md dshx:bg-background/70 dshx:px-1.5 dshx:text-[11px] dshx:tabular-nums dshx:text-muted-foreground">
                {column.length}
              </span>
              <button
                type="button"
                aria-label={`Add to ${ItemGlyphs.statusLabels[status]}`}
                onClick={() => props.captureInto(status)}
                className="dshx:ml-auto dshx:rounded-md dshx:p-1 dshx:text-muted-foreground dshx:transition-colors dshx:hover:bg-accent dshx:hover:text-foreground"
              >
                <PlusIcon className="dshx:size-3.5" />
              </button>
            </header>
            <div
              className="dshx:flex dshx:min-h-16 dshx:flex-1 dshx:flex-col dshx:gap-1.5 dshx:overflow-y-auto dshx:p-0.5"
              onScroll={event => {
                const element = event.currentTarget
                if (element.scrollHeight - element.scrollTop - element.clientHeight > 240) return
                setPages(current => {
                  const page = current[status] ?? 1
                  if (column.length <= page * COLUMN_PAGE) return current
                  return { ...current, [status]: page + 1 }
                })
              }}
            >
              {column.length === 0 ? <p className="dshx:py-6 dshx:text-center dshx:text-xs dshx:text-muted-foreground/70">Nothing here</p> : null}
              {column.slice(0, (pages[status] ?? 1) * COLUMN_PAGE).map(item => (
                <BoardCard
                  key={item.id}
                  item={item}
                  openId={props.openId}
                  open={props.open}
                  startDrag={startDrag}
                  pickStatus={move}
                  startThread={props.startThread}
                  projectPaths={props.projectPaths}
                  dragging={drag?.id === item.id}
                />
              ))}
            </div>
          </section>
        )
      })}
      {drag === null || dragged === undefined ? null : (
        <article
          aria-hidden
          style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }}
          className={cn(cardClass, 'dshx:pointer-events-none dshx:fixed dshx:z-[1100] dshx:rotate-[1.5deg] dshx:border-input dshx:shadow-xl')}
        >
          <CardFace item={dragged} />
        </article>
      )}
    </div>
  )
}
