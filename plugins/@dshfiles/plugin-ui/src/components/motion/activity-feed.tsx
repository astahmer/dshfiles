import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { PresenceList, type PresenceListItem } from './presence-list.js'
import { SlidingSegments, type SlidingSegmentOption } from './sliding-segments.js'

export type ActivityTone = 'info' | 'success' | 'warning' | 'destructive' | 'violet' | 'teal' | 'muted'

export interface ActivityActor {
  readonly name: string
  /** Two letters for the avatar tile. */
  readonly initials: string
  readonly tone?: ActivityTone
}

export interface ActivityFeedEvent {
  readonly id: string
  readonly actor: ActivityActor
  /** "completed", "moved", "commented on". */
  readonly verb: string
  /** The thing acted on, shown bold. */
  readonly target: string
  /** Optional second object: "to" + "Review". */
  readonly preposition?: string
  readonly destination?: string
  /** Where it happened ("Mobile App"), shown as "in …". */
  readonly scope?: string
  /** Relative time label ("5d ago"). */
  readonly time: string
  /** Section heading this event belongs to ("This week", "Earlier"); sections keep first-appearance order. */
  readonly group: string
}

export interface ActivityFeedProps<F extends string> extends Omit<React.HTMLAttributes<HTMLElement>, 'onSelect'> {
  readonly events: readonly ActivityFeedEvent[]
  readonly filters?: readonly SlidingSegmentOption<F>[]
  readonly filter?: F
  readonly onFilterChange?: (filter: F) => void
  /** Extra toolbar controls after the filters (a people picker). */
  readonly actions?: React.ReactNode
  /** Groups whose rows read as older (dimmer times). */
  readonly quietGroups?: readonly string[]
  readonly onSelectEvent?: (event: ActivityFeedEvent) => void
  readonly emptyLabel?: string
}

const noGroups: readonly string[] = []

const toneClass = {
  info: 'dshx:bg-info/15 dshx:text-info',
  success: 'dshx:bg-success/15 dshx:text-success',
  warning: 'dshx:bg-warning/15 dshx:text-warning',
  destructive: 'dshx:bg-destructive/15 dshx:text-destructive',
  violet: 'dshx:bg-violet/15 dshx:text-violet',
  teal: 'dshx:bg-teal/15 dshx:text-teal',
  muted: 'dshx:bg-muted dshx:text-muted-foreground',
} as const satisfies Record<ActivityTone, string>

/**
 * A grouped feed of who did what ("Luna completed Fix flaky test in dshfiles"). Filtering glides the pill and the
 * rows: survivors FLIP into place, dropped rows fade and collapse, new events drop in at the top. A week of backlog,
 * thread and revision activity read without pinging anyone.
 */
export function ActivityFeed<F extends string>({
  events,
  filters,
  filter,
  onFilterChange,
  actions,
  quietGroups = noGroups,
  onSelectEvent,
  emptyLabel = 'Nothing here yet.',
  className,
  ...props
}: ActivityFeedProps<F>) {
  const items = React.useMemo<PresenceListItem[]>(() => {
    const order: string[] = []
    const byGroup = new Map<string, ActivityFeedEvent[]>()
    for (const event of events) {
      let list = byGroup.get(event.group)
      if (list === undefined) {
        list = []
        byGroup.set(event.group, list)
        order.push(event.group)
      }
      list.push(event)
    }
    const result: PresenceListItem[] = []
    for (const group of order) {
      result.push({
        key: `group:${group}`,
        node: (
          <h3 className="dshx:pt-3 dshx:pb-1.5 dshx:text-[11px] dshx:font-semibold dshx:tracking-wider dshx:text-muted-foreground dshx:uppercase">{group}</h3>
        ),
      })
      for (const event of byGroup.get(group) ?? []) {
        result.push({ key: event.id, node: <FeedRow event={event} quiet={quietGroups.includes(group)} onSelect={onSelectEvent} /> })
      }
    }
    return result
  }, [events, quietGroups, onSelectEvent])

  return (
    <section className={cn('dshx:@container dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2', className)} {...props}>
      {filters && filter !== undefined ? (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
          <SlidingSegments
            aria-label="Filter activity"
            size="sm"
            options={filters}
            value={filter}
            onValueChange={value => onFilterChange?.(value)}
            className="dshx:@max-pane-narrow:max-w-full dshx:@max-pane-narrow:overflow-x-auto"
          />
          {actions}
        </div>
      ) : null}
      {events.length === 0 ? <p className="dshx:py-6 dshx:text-center dshx:text-sm dshx:text-muted-foreground">{emptyLabel}</p> : null}
      <PresenceList as="div" role="feed" aria-label="Activity" className="dshx:flex dshx:flex-col" enter="dropIn" items={items} />
    </section>
  )
}

function FeedRow({
  event,
  quiet,
  onSelect,
}: {
  readonly event: ActivityFeedEvent
  readonly quiet: boolean
  readonly onSelect: ((event: ActivityFeedEvent) => void) | undefined
}) {
  const sentence = (
    <>
      <span className="dshx:font-medium dshx:text-foreground">{event.actor.name}</span> {event.verb}{' '}
      <span className="dshx:font-medium dshx:text-foreground">{event.target}</span>
      {event.preposition && event.destination ? (
        <>
          {' '}
          {event.preposition} <span className="dshx:text-foreground">{event.destination}</span>
        </>
      ) : null}
      {event.scope ? <> in {event.scope}</> : null}
    </>
  )
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'dshx:grid dshx:size-5 dshx:shrink-0 dshx:place-items-center dshx:rounded-full dshx:text-[8px] dshx:font-semibold dshx:tracking-tight',
          toneClass[event.actor.tone ?? 'muted'],
        )}
      >
        {event.actor.initials}
      </span>
      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-left dshx:text-muted-foreground">{sentence}</span>
      <time
        className={cn(
          'dshx:shrink-0 dshx:text-xs dshx:whitespace-nowrap dshx:tabular-nums',
          quiet ? 'dshx:text-muted-foreground/50' : 'dshx:text-muted-foreground',
        )}
      >
        {event.time}
      </time>
    </>
  )
  const rowClass =
    'dshx:flex dshx:w-full dshx:items-center dshx:gap-2.5 dshx:rounded-md dshx:px-1.5 dshx:py-1.5 dshx:text-[13px] dshx:transition-colors dshx:hover:bg-accent/60'
  return onSelect ? (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className={cn(rowClass, 'dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50')}
    >
      {body}
    </button>
  ) : (
    <article className={rowClass}>{body}</article>
  )
}
