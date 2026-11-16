import type { ReactNode } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'

import { BacklogItems, type BacklogStatus } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'

const itemCount = (count: number): string => `${String(count)} ${count === 1 ? 'item' : 'items'}`
const ALL = 'all'

/** The statuses worth a filter: any with items, plus a chosen one so it can still be cleared. */
export const visibleStatuses = (counts: Record<BacklogStatus, number>, chosen: readonly BacklogStatus[]): readonly BacklogStatus[] =>
  BacklogItems.statuses.filter(status => counts[status] > 0 || chosen.includes(status))

/**
 * A filter over one list, so the kit toggle group: "All" plus one toggle per status that has items, each toggled
 * independently (pick one to read it, pick more to read them together). Counts are muted text; the row scrolls
 * sideways in a narrow pane instead of clipping a label.
 */
export const StatusFilterBar = (props: {
  readonly counts: Record<BacklogStatus, number>
  readonly statuses: readonly BacklogStatus[]
  readonly toggle: (status: BacklogStatus) => void
  readonly clear: () => void
  readonly trailing?: ReactNode
}): JSX.Element => {
  const total = Object.values(props.counts).reduce((sum, count) => sum + count, 0)
  const shown = visibleStatuses(props.counts, props.statuses)
  const value = props.statuses.length === 0 ? [ALL] : [...props.statuses]
  return (
    <div className="dshx:flex dshx:h-10 dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-3">
      <ToggleGroup
        type="multiple"
        aria-label="Filter by status"
        role="group"
        size="sm"
        spacing={1}
        value={value}
        onValueChange={next => {
          if (next.includes(ALL) && !value.includes(ALL)) return props.clear()
          const added = BacklogItems.statuses.find(status => next.includes(status) && !props.statuses.includes(status))
          const removed = props.statuses.find(status => !next.includes(status))
          const changed = added ?? removed
          if (changed !== undefined) props.toggle(changed)
        }}
        className="dshx:min-w-0 dshx:flex-1 dshx:overflow-x-auto dshx:overflow-y-hidden dshx:[scrollbar-width:none] dshx:[&::-webkit-scrollbar]:hidden"
      >
        <ToggleGroupItem value={ALL} aria-label={`All statuses, ${itemCount(total)}`} className="dshx:gap-1 dshx:text-sm">
          All
          <span className="dshx:text-2xs dshx:text-muted-foreground dshx:tabular-nums">{total}</span>
        </ToggleGroupItem>
        {shown.map(status => (
          <ToggleGroupItem
            key={status}
            value={status}
            aria-label={`${ItemGlyphs.statusLabels[status]}, ${itemCount(props.counts[status])}`}
            className="dshx:gap-1 dshx:text-sm"
          >
            {ItemGlyphs.statusLabels[status]}
            <span className="dshx:text-2xs dshx:text-muted-foreground dshx:tabular-nums">{props.counts[status]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {props.trailing}
    </div>
  )
}
