import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi } from '@dshfiles/dshx/client'
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
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import {
  WandSparklesIcon,
  ChevronDownIcon,
  KanbanIcon,
  LinkIcon,
  ListFilterIcon,
  ListIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { errorMessage, keepPreviousData, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { z } from 'zod'

import { backlogApi, type BacklogSummaryView } from './api.js'
import { BacklogItems, type BacklogKind, type BacklogStatus } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'
import { BacklogPeek } from './item-peek.js'
import { ItemPickers } from './item-pickers.js'
import { BacklogQueries, useBacklogActions } from './use-backlog-actions.js'

type OpenThread = (sessionId: string) => void
type FreshnessFilter = 'active' | 'all' | 'dormant' | 'archived'

const DAY_MS = 86_400_000
/** Agents write from other threads; a short poll keeps the open panel current without a push channel. */
const REFRESH_MS = 5_000
const boardStatuses: readonly BacklogStatus[] = ['inbox', 'todo', 'doing', 'done']
const freshnessLabels = { active: 'Active', dormant: 'Dormant', archived: 'Archived', all: 'Everything' } satisfies Record<FreshnessFilter, string>
const freshnessFilters = ['active', 'dormant', 'archived', 'all'] as const
const AGO_SUFFIX = { minutes: 'm', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const
const chipClass =
  'dshx:inline-flex dshx:h-5 dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-full dshx:border dshx:border-border dshx:px-2 dshx:text-[11px] dshx:text-muted-foreground'

const viewPreference = createStoredValue({ key: 'dshfiles.backlog.view.v1', schema: z.enum(['list', 'board']), fallback: 'list' })

const ago = (time: number): string => {
  const age = relativeTime(time, Date.now())
  return age.unit === 'now' ? 'now' : `${String(age.n)}${AGO_SUFFIX[age.unit]}`
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

const freshnessOf = (value: string): FreshnessFilter => freshnessFilters.find(filter => filter === value) ?? 'active'

/** The Discord order, sliced the way a chat history reads: pinned on top, then today, yesterday, this week, earlier. */
const groupByActivity = (items: readonly BacklogSummaryView[], now: number) => {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  const buckets = [
    { label: 'Pinned', test: (item: BacklogSummaryView) => item.pinned },
    { label: 'Today', test: (item: BacklogSummaryView) => item.lastActivityAt >= startOfToday },
    { label: 'Yesterday', test: (item: BacklogSummaryView) => item.lastActivityAt >= startOfToday - DAY_MS },
    { label: 'This week', test: (item: BacklogSummaryView) => item.lastActivityAt >= startOfToday - 6 * DAY_MS },
    { label: 'Earlier', test: () => true },
  ]
  return buckets
    .map((bucket, index) => ({
      label: bucket.label,
      items: items.filter(item => buckets.findIndex(candidate => candidate.test(item)) === index),
    }))
    .filter(group => group.items.length > 0)
}

const Tags = (props: { readonly tags: readonly string[] }): JSX.Element | null =>
  props.tags.length === 0 ? null : (
    <span className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:@max-pane-compact:hidden">
      {props.tags.slice(0, 3).map(tag => (
        <span key={tag} className={chipClass}>
          #{tag}
        </span>
      ))}
    </span>
  )

const Freshness = (props: { readonly freshness: BacklogSummaryView['freshness'] }): JSX.Element | null =>
  props.freshness === 'fresh' ? null : (
    <span
      className={cn(
        'dshx:shrink-0 dshx:rounded-full dshx:px-1.5 dshx:text-[11px]',
        props.freshness === 'stale' ? 'dshx:bg-warning/15 dshx:text-warning' : 'dshx:bg-muted dshx:text-muted-foreground',
      )}
    >
      {props.freshness}
    </span>
  )

const ItemRow = (props: {
  readonly item: BacklogSummaryView
  readonly cursor: boolean
  readonly open: boolean
  readonly select: (id: number) => void
  readonly hover: (id: number) => void
}): JSX.Element => {
  const actions = useBacklogActions()
  const item = props.item
  const row = useRef<HTMLLIElement | null>(null)
  useEffect(() => {
    if (props.cursor) row.current?.scrollIntoView({ block: 'nearest' })
  }, [props.cursor])
  return (
    <li
      ref={row}
      aria-label={`Item b:${String(item.id)}`}
      aria-current={props.open ? 'true' : undefined}
      onMouseMove={() => props.hover(item.id)}
      onClick={() => props.select(item.id)}
      className={cn(
        'dshx:group/row dshx:relative dshx:flex dshx:h-9 dshx:cursor-default dshx:items-center dshx:gap-2.5 dshx:px-4 dshx:text-[13px] dshx:transition-colors dshx:duration-75',
        props.open ? 'dshx:bg-accent' : props.cursor ? 'dshx:bg-accent/60' : 'dshx:hover:bg-accent/40',
      )}
    >
      {props.open ? <span aria-hidden className="dshx:absolute dshx:inset-y-1.5 dshx:left-0 dshx:w-0.5 dshx:rounded-full dshx:bg-info" /> : null}
      <span className="dshx:w-9 dshx:shrink-0 dshx:font-mono! dshx:text-xs dshx:text-muted-foreground">b:{item.id}</span>
      <ItemPickers.Status id={item.id} status={item.status} onPick={status => actions.update.mutate({ id: item.id, status })} />
      <ItemGlyphs.KindIcon kind={item.kind} />
      <span className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate', (item.status === 'done' || item.status === 'dropped') && 'dshx:text-muted-foreground')}>
        {item.title}
      </span>
      {item.proposal === null ? null : <WandSparklesIcon aria-label="Triage suggestion waiting" className="dshx:size-3 dshx:shrink-0 dshx:text-violet" />}
      {item.pinned ? <PinIcon aria-label="Pinned" className="dshx:size-3 dshx:shrink-0 dshx:fill-current dshx:text-warning" /> : null}
      <Freshness freshness={item.freshness} />
      <Tags tags={item.tags} />
      {item.links.length === 0 ? null : (
        <span
          title={`${String(item.links.length)} links`}
          className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-0.5 dshx:text-[11px] dshx:text-muted-foreground dshx:@max-pane-narrow:hidden"
        >
          <LinkIcon aria-hidden className="dshx:size-3" />
          {item.links.length}
        </span>
      )}
      <ItemGlyphs.ActorAvatar actorId={item.actors[0]?.id} />
      <span className="dshx:w-7 dshx:shrink-0 dshx:text-right dshx:text-[11px] dshx:tabular-nums dshx:text-muted-foreground">{ago(item.lastActivityAt)}</span>
    </li>
  )
}

const ListView = (props: {
  readonly groups: ReturnType<typeof groupByActivity>
  readonly cursorId: number | null
  readonly openId: number | null
  readonly select: (id: number) => void
  readonly hover: (id: number) => void
}): JSX.Element => (
  <ul aria-label="Backlog feed" className="dshx:flex dshx:flex-col dshx:pb-8">
    {props.groups.map(group => (
      <li key={group.label} aria-label={group.label}>
        <div className="dshx:sticky dshx:top-0 dshx:z-10 dshx:flex dshx:h-8 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border/60 dshx:bg-background/90 dshx:px-4 dshx:text-xs dshx:backdrop-blur">
          <span className="dshx:font-medium">{group.label}</span>
          <span className="dshx:tabular-nums dshx:text-muted-foreground">{group.items.length}</span>
        </div>
        <ul className="dshx:flex dshx:flex-col">
          {group.items.map(item => (
            <ItemRow key={item.id} item={item} cursor={item.id === props.cursorId} open={item.id === props.openId} select={props.select} hover={props.hover} />
          ))}
        </ul>
      </li>
    ))}
  </ul>
)

type Drag = { readonly id: number; readonly x: number; readonly y: number; readonly offsetX: number; readonly offsetY: number; readonly width: number }

const BoardCardFace = (props: { readonly item: BacklogSummaryView; readonly onPickStatus?: (status: BacklogStatus) => void }): JSX.Element => {
  const item = props.item
  return (
    <>
      <div className="dshx:flex dshx:items-center dshx:gap-2">
        <span className="dshx:font-mono! dshx:text-[11px] dshx:text-muted-foreground">b:{item.id}</span>
        <ItemGlyphs.KindIcon kind={item.kind} />
        <span className="dshx:ml-auto">
          <ItemGlyphs.ActorAvatar actorId={item.actors[0]?.id} />
        </span>
      </div>
      <div className="dshx:flex dshx:items-start dshx:gap-1.5">
        <span className="dshx:-mt-0.5 dshx:-ml-1">
          {props.onPickStatus === undefined ? (
            <span className="dshx:inline-flex dshx:size-6 dshx:items-center dshx:justify-center">
              <ItemGlyphs.StatusIcon status={item.status} />
            </span>
          ) : (
            <ItemPickers.Status id={item.id} status={item.status} onPick={props.onPickStatus} />
          )}
        </span>
        <p className="dshx:line-clamp-3 dshx:min-w-0 dshx:flex-1 dshx:text-[13px] dshx:leading-snug dshx:font-medium">{item.title}</p>
      </div>
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1">
        {item.tags.slice(0, 3).map(tag => (
          <span key={tag} className={chipClass}>
            #{tag}
          </span>
        ))}
        <Freshness freshness={item.freshness} />
        <span className="dshx:ml-auto dshx:text-[11px] dshx:text-muted-foreground dshx:tabular-nums">{ago(item.lastActivityAt)}</span>
      </div>
    </>
  )
}

const cardClass =
  'dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:bg-card dshx:p-3 dshx:shadow-xs dshx:transition-[border-color,box-shadow,opacity] dshx:duration-100 dshx:select-none'

/**
 * Pointer-driven drag, not HTML5 drag and drop: the card lifts and follows the cursor, the column under it lights up,
 * and a plain click (under 4px of travel) still opens the peek.
 */
const BoardView = (props: {
  readonly items: readonly BacklogSummaryView[]
  readonly openId: number | null
  readonly select: (id: number) => void
  readonly captureInto: (status: BacklogStatus) => void
}): JSX.Element => {
  const actions = useBacklogActions()
  const [drag, setDrag] = useState<Drag | null>(null)
  const [over, setOver] = useState<BacklogStatus | null>(null)
  const dragged = drag === null ? undefined : props.items.find(item => item.id === drag.id)

  const columnAt = (x: number, y: number): BacklogStatus | null => {
    const value = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-backlog-column]')?.dataset['backlogColumn']
    return boardStatuses.find(status => status === value) ?? null
  }

  const startDrag = (event: ReactPointerEvent<HTMLElement>, item: BacklogSummaryView): void => {
    if (event.button !== 0 || (event.target instanceof HTMLElement && event.target.closest('button') !== null)) return
    const card = event.currentTarget.getBoundingClientRect()
    const origin = { x: event.clientX, y: event.clientY }
    let started = false
    const move = (moveEvent: PointerEvent): void => {
      if (!started && Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) < 4) return
      started = true
      setDrag({ id: item.id, x: moveEvent.clientX, y: moveEvent.clientY, offsetX: origin.x - card.left, offsetY: origin.y - card.top, width: card.width })
      setOver(columnAt(moveEvent.clientX, moveEvent.clientY))
    }
    const up = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      setOver(null)
      if (!started) {
        props.select(item.id)
        return
      }
      const target = columnAt(upEvent.clientX, upEvent.clientY)
      if (target !== null && target !== item.status) actions.update.mutate({ id: item.id, status: target })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className={cn('dshx:flex dshx:h-full dshx:min-h-0 dshx:gap-3 dshx:overflow-x-auto dshx:px-4 dshx:py-3', drag !== null && 'dshx:cursor-grabbing')}>
      {boardStatuses.map(status => {
        const column = props.items.filter(item => item.status === status)
        return (
          <section
            key={status}
            data-backlog-column={status}
            aria-label={`${ItemGlyphs.statusLabels[status]} column`}
            className={cn(
              'dshx:flex dshx:min-h-0 dshx:min-w-60 dshx:max-w-80 dshx:flex-1 dshx:flex-col dshx:rounded-xl dshx:transition-colors dshx:duration-100',
              over === status && dragged?.status !== status ? 'dshx:bg-info/10 dshx:ring-1 dshx:ring-info/40' : 'dshx:bg-muted/40',
            )}
          >
            <header className="dshx:flex dshx:h-10 dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:px-3">
              <ItemGlyphs.StatusIcon status={status} />
              <h3 className="dshx:text-[13px] dshx:font-medium">{ItemGlyphs.statusLabels[status]}</h3>
              <span className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">{column.length}</span>
              <button
                type="button"
                aria-label={`Add to ${ItemGlyphs.statusLabels[status]}`}
                onClick={() => props.captureInto(status)}
                className="dshx:ml-auto dshx:rounded-md dshx:p-1 dshx:text-muted-foreground dshx:transition-colors dshx:hover:bg-accent dshx:hover:text-foreground"
              >
                <PlusIcon className="dshx:size-3.5" />
              </button>
            </header>
            <div className="dshx:flex dshx:min-h-16 dshx:flex-1 dshx:flex-col dshx:gap-2 dshx:overflow-y-auto dshx:px-2 dshx:pb-2">
              {column.map(item => (
                <article
                  key={item.id}
                  aria-label={`Card b:${String(item.id)}`}
                  onPointerDown={event => startDrag(event, item)}
                  className={cn(
                    cardClass,
                    'dshx:cursor-grab dshx:hover:border-input dshx:hover:shadow-sm',
                    item.id === props.openId ? 'dshx:border-info/60 dshx:ring-1 dshx:ring-info/30' : 'dshx:border-border',
                    drag?.id === item.id && 'dshx:opacity-30',
                  )}
                >
                  <BoardCardFace item={item} onPickStatus={status => actions.update.mutate({ id: item.id, status })} />
                </article>
              ))}
            </div>
          </section>
        )
      })}
      {drag === null || dragged === undefined ? null : (
        <article
          aria-hidden
          style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }}
          className={cn(cardClass, 'dshx:pointer-events-none dshx:fixed dshx:z-[1100] dshx:rotate-2 dshx:border-input dshx:shadow-lg')}
        >
          <BoardCardFace item={dragged} />
        </article>
      )}
    </div>
  )
}

/** One box for everything; the chips under it show what triage will make of the text before it is added. */
const Capture = (props: {
  readonly status: BacklogStatus | null
  readonly clearStatus: () => void
  readonly inputRef: RefObject<HTMLTextAreaElement>
}): JSX.Element => {
  const actions = useBacklogActions()
  const [text, setText] = useState('')
  const preview = useMemo(() => (text.trim() === '' ? null : BacklogItems.triage(text)), [text])
  const submit = (): void => {
    if (text.trim() === '') return
    setText('')
    props.clearStatus()
    // Cleared before the Host answers so capture feels instant; a failure puts the text back unless more was typed.
    const input = props.status === null ? { text } : { text, status: props.status }
    actions.capture.mutate(input, { onError: () => setText(current => (current === '' ? text : current)) })
  }
  return (
    <div className="dshx:border-b dshx:border-border dshx:px-4 dshx:py-2.5">
      <form
        onSubmit={event => {
          event.preventDefault()
          submit()
        }}
        className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:px-3 dshx:py-2 dshx:shadow-xs dshx:transition-[border-color,box-shadow] dshx:focus-within:border-input dshx:focus-within:shadow-sm"
      >
        <div className="dshx:flex dshx:items-start dshx:gap-2">
          <PlusIcon aria-hidden className="dshx:mt-0.5 dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
          <textarea
            ref={props.inputRef}
            aria-label="Capture"
            rows={1}
            placeholder="Capture anything — a thought, a task, a bug…"
            value={text}
            onChange={event => setText(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.currentTarget.blur()
                return
              }
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              submit()
            }}
            className="dshx:field-sizing-content dshx:max-h-48 dshx:min-h-5 dshx:flex-1 dshx:resize-none dshx:bg-transparent dshx:text-[13px] dshx:leading-5 dshx:outline-none dshx:placeholder:text-muted-foreground"
          />
          {text.trim() === '' ? null : <Kbd className="dshx:shrink-0">↵</Kbd>}
        </div>
        {preview === null && props.status === null ? (
          <p className="dshx:pl-6 dshx:text-[11px] dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">
            <code>bug:</code> <code>idea:</code> <code>note:</code> set the kind · <code>#tag</code> · <code>b:12</code> <code>jj:rev</code> and URLs link ·{' '}
            <Kbd>C</Kbd> to capture
          </p>
        ) : (
          <div aria-label="Capture preview" className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:pl-6 dshx:animate-in dshx:fade-in-0">
            {props.status === null ? null : (
              <span className={chipClass}>
                <ItemGlyphs.StatusIcon status={props.status} className="dshx:size-3" />
                {ItemGlyphs.statusLabels[props.status]}
                <button type="button" aria-label="Clear status" onClick={props.clearStatus} className="dshx:hover:text-foreground">
                  <XIcon className="dshx:size-3" />
                </button>
              </span>
            )}
            {preview === null ? null : (
              <>
                <span className={chipClass}>
                  <ItemGlyphs.KindIcon kind={preview.kind} className="dshx:size-3" />
                  {ItemGlyphs.kindLabels[preview.kind]}
                </span>
                {preview.tags.map(tag => (
                  <span key={tag} className={chipClass}>
                    #{tag}
                  </span>
                ))}
                {preview.links.map(link => (
                  <span key={`${link.type}:${link.target}`} className={cn(chipClass, 'dshx:max-w-48')}>
                    <LinkIcon aria-hidden className="dshx:size-3 dshx:shrink-0" />
                    <span className="dshx:truncate">{link.type === 'item' ? `b:${link.target}` : link.target}</span>
                  </span>
                ))}
              </>
            )}
          </div>
        )}
        {actions.capture.isError ? (
          <p className="dshx:pl-6 dshx:text-xs dshx:text-destructive">{errorMessage(actions.capture.error, 'Could not add the item.')}</p>
        ) : null}
      </form>
    </div>
  )
}

const FilterMenu = (props: {
  readonly kinds: readonly BacklogKind[]
  readonly setKinds: (kinds: BacklogKind[]) => void
  readonly freshness: FreshnessFilter
  readonly setFreshness: (value: FreshnessFilter) => void
}): JSX.Element => {
  const active = props.kinds.length + (props.freshness === 'active' ? 0 : 1)
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
        <span className="dshx:@max-pane-narrow:sr-only">Filter</span>
        {active > 0 ? <span className="dshx:rounded-full dshx:bg-info/15 dshx:px-1.5 dshx:text-[10px] dshx:text-info">{active}</span> : null}
        <ChevronDownIcon className="dshx:size-3 dshx:opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="dshx-root dshx:w-52">
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
        <DropdownMenuLabel className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">Show</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={props.freshness} onValueChange={value => props.setFreshness(freshnessOf(value))}>
          {freshnessFilters.map(value => (
            <DropdownMenuRadioItem key={value} value={value} className="dshx:text-[13px]">
              {freshnessLabels[value]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const EmptyState = (props: { readonly filtered: boolean }): JSX.Element => (
  <div className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-2 dshx:px-6 dshx:py-24 dshx:text-center dshx:animate-in dshx:fade-in-0">
    <ItemGlyphs.StatusIcon status="inbox" className="dshx:mb-1 dshx:size-8" />
    <p className="dshx:text-sm dshx:font-medium">{props.filtered ? 'Nothing matches' : 'Inbox zero'}</p>
    <p className="dshx:max-w-72 dshx:text-xs dshx:text-muted-foreground">
      {props.filtered ? 'Try another search or filter.' : 'Capture anything above. It sorts itself, and idle things sink on their own.'}
    </p>
  </div>
)

const Shortcuts = (): JSX.Element => (
  <footer className="dshx:flex dshx:h-8 dshx:shrink-0 dshx:items-center dshx:gap-3 dshx:border-t dshx:border-border dshx:px-4 dshx:text-[11px] dshx:text-muted-foreground dshx:@max-pane-compact:hidden">
    <span className="dshx:flex dshx:items-center dshx:gap-1">
      <Kbd>J</Kbd>
      <Kbd>K</Kbd> move
    </span>
    <span className="dshx:flex dshx:items-center dshx:gap-1">
      <Kbd>↵</Kbd> open
    </span>
    <span className="dshx:flex dshx:items-center dshx:gap-1">
      <Kbd>C</Kbd> capture
    </span>
    <span className="dshx:flex dshx:items-center dshx:gap-1">
      <Kbd>/</Kbd> search
    </span>
    <span className="dshx:flex dshx:items-center dshx:gap-1">
      <Kbd>B</Kbd> board
    </span>
  </footer>
)

export const BacklogPanel = (props: { readonly openThread: OpenThread }): JSX.Element => {
  const api = useApi(backlogApi)
  const view = viewPreference.useValue()
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<BacklogKind[]>([])
  const [freshness, setFreshness] = useState<FreshnessFilter>('active')
  const [openId, setOpenId] = useState<number | null>(null)
  const [cursorId, setCursorId] = useState<number | null>(null)
  const [captureStatus, setCaptureStatus] = useState<BacklogStatus | null>(null)
  const captureInput = useRef<HTMLTextAreaElement>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  const debounced = useDebouncedValue({ value: query, delayMs: 150 })
  const list = useQuery({
    queryKey: [BacklogQueries.key, 'list', debounced, kinds, freshness],
    queryFn: ({ signal }) => api.list({ query: debounced, kinds, freshness, limit: 500 }, { signal }),
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
  })
  const items = useMemo(() => list.data?.items ?? [], [list.data])
  const groups = useMemo(() => groupByActivity(items, list.dataUpdatedAt), [items, list.dataUpdatedAt])
  const order = view === 'list' ? groups.flatMap(group => group.items) : boardStatuses.flatMap(status => items.filter(item => item.status === status))
  const filtered = debounced !== '' || kinds.length > 0 || freshness !== 'active'

  const moveCursor = (step: number): void => {
    const index = order.findIndex(item => item.id === (cursorId ?? openId))
    const next = order[Math.min(order.length - 1, Math.max(0, index === -1 ? 0 : index + step))]
    if (next === undefined) return
    setCursorId(next.id)
    if (openId !== null) setOpenId(next.id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'j' || event.key === 'ArrowDown') moveCursor(1)
    else if (event.key === 'k' || event.key === 'ArrowUp') moveCursor(-1)
    else if (event.key === 'Enter' && cursorId !== null) setOpenId(cursorId)
    else if (event.key === 'Escape' && openId !== null) setOpenId(null)
    else if (event.key === 'c') captureInput.current?.focus()
    else if (event.key === '/') searchInput.current?.focus()
    else if (event.key === 'b') viewPreference.set(view === 'list' ? 'board' : 'list')
    else return
    event.preventDefault()
  }

  return (
    <main
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="dshx-root dshx:@container dshx:relative dshx:flex dshx:h-full dshx:min-h-0 dshx:bg-background dshx:text-foreground dshx:outline-none"
    >
      <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col">
        <header className="dshx:flex dshx:h-11 dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-4">
          <h2 className="dshx:text-[13px] dshx:font-semibold">Backlog</h2>
          {list.data === undefined ? null : <span className="dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">{list.data.total}</span>}
          <ToggleGroup
            type="single"
            size="sm"
            aria-label="Backlog views"
            value={view}
            onValueChange={value => {
              if (value === 'list' || value === 'board') viewPreference.set(value)
            }}
            className="dshx:ml-2"
          >
            <ToggleGroupItem value="list" aria-label="List" className="dshx:h-7 dshx:gap-1.5 dshx:px-2 dshx:text-xs">
              <ListIcon className="dshx:size-3.5" />
              <span className="dshx:@max-pane-narrow:sr-only">List</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="board" aria-label="Board" className="dshx:h-7 dshx:gap-1.5 dshx:px-2 dshx:text-xs">
              <KanbanIcon className="dshx:size-3.5" />
              <span className="dshx:@max-pane-narrow:sr-only">Board</span>
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="dshx:ml-auto dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1">
            <label className="dshx:flex dshx:h-7 dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-2 dshx:text-muted-foreground dshx:transition-colors dshx:focus-within:bg-accent dshx:hover:bg-accent/60">
              <SearchIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
              <input
                ref={searchInput}
                aria-label="Search backlog"
                placeholder="Search"
                value={query}
                onChange={event => setQuery(event.currentTarget.value)}
                onKeyDown={event => {
                  if (event.key !== 'Escape') return
                  setQuery('')
                  event.currentTarget.blur()
                }}
                className="dshx:w-32 dshx:min-w-0 dshx:bg-transparent dshx:text-xs dshx:text-foreground dshx:outline-none dshx:placeholder:text-muted-foreground dshx:@max-pane-narrow:w-20"
              />
              {query === '' ? <Kbd className="dshx:@max-pane-narrow:hidden">/</Kbd> : null}
            </label>
            <FilterMenu kinds={kinds} setKinds={setKinds} freshness={freshness} setFreshness={setFreshness} />
          </div>
        </header>
        <Capture status={captureStatus} clearStatus={() => setCaptureStatus(null)} inputRef={captureInput} />
        {list.isError ? (
          <p className="dshx:px-4 dshx:py-2 dshx:text-xs dshx:text-destructive">{errorMessage(list.error, 'The backlog is unavailable.')}</p>
        ) : null}
        <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-auto">
          {list.isSuccess && items.length === 0 ? <EmptyState filtered={filtered} /> : null}
          {items.length === 0 ? null : view === 'list' ? (
            <ListView groups={groups} cursorId={cursorId} openId={openId} select={setOpenId} hover={setCursorId} />
          ) : (
            <BoardView
              items={items}
              openId={openId}
              select={setOpenId}
              captureInto={status => {
                setCaptureStatus(status)
                captureInput.current?.focus()
              }}
            />
          )}
        </div>
        <Shortcuts />
      </div>
      {openId === null ? null : (
        <BacklogPeek.Panel
          key={openId}
          id={openId}
          summary={items.find(item => item.id === openId)}
          openThread={props.openThread}
          select={id => {
            setOpenId(id)
            setCursorId(id)
          }}
          close={() => setOpenId(null)}
        />
      )}
    </main>
  )
}
