import type { ReactNode } from 'react'
import { cn } from '@dshfiles/plugin-ui/lib/utils'

import { BacklogItems, type BacklogStatus } from './item.js'
import { ItemGlyphs } from './item-glyphs.js'

const chipClass = (active: boolean): string =>
  cn(
    'dshx:inline-flex dshx:h-6 dshx:shrink-0 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:px-2 dshx:text-[11px] dshx:transition-colors',
    active
      ? 'dshx:border-border dshx:bg-background dshx:text-foreground dshx:shadow-xs'
      : 'dshx:border-transparent dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground',
  )

const itemCount = (count: number): string => `${String(count)} ${count === 1 ? 'item' : 'items'}`

/** One chip per status, each toggled independently: pick one to read it, pick more to read them together. */
export const StatusFilterBar = (props: {
  readonly counts: Record<BacklogStatus, number>
  readonly statuses: readonly BacklogStatus[]
  readonly toggle: (status: BacklogStatus) => void
  readonly clear: () => void
  readonly trailing?: ReactNode
}): JSX.Element => {
  const total = Object.values(props.counts).reduce((sum, count) => sum + count, 0)
  return (
    <div className="dshx:flex dshx:h-9 dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:border-b dshx:border-border dshx:px-4">
      <div role="group" aria-label="Filter by status" className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1 dshx:overflow-x-auto">
        <button
          type="button"
          aria-pressed={props.statuses.length === 0}
          aria-label={`All statuses, ${itemCount(total)}`}
          onClick={props.clear}
          className={cn(chipClass(props.statuses.length === 0), 'dshx:font-medium')}
        >
          All
          <span className={cn('dshx:tabular-nums', props.statuses.length === 0 ? 'dshx:text-foreground' : 'dshx:text-muted-foreground/80')}>{total}</span>
        </button>
        {BacklogItems.statuses.map(status => {
          const count = props.counts[status]
          const active = props.statuses.includes(status)
          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              aria-label={`${ItemGlyphs.statusLabels[status]}, ${itemCount(count)}`}
              onClick={() => props.toggle(status)}
              className={chipClass(active)}
            >
              <ItemGlyphs.StatusIcon status={status} />
              <span className="dshx:@max-pane-compact:sr-only">{ItemGlyphs.statusLabels[status]}</span>
              <span className={cn('dshx:tabular-nums', active ? 'dshx:text-foreground' : 'dshx:text-muted-foreground/80')}>{count}</span>
            </button>
          )
        })}
      </div>
      {props.trailing}
    </div>
  )
}
