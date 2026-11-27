import { cn } from '@dshfiles/plugin-ui/lib/utils'

export interface SegmentedFilterOption<Id extends string> {
  readonly id: Id
  readonly label: string
  readonly count?: number | undefined
}

/**
 * A row of pressed/unpressed buttons that picks one filter value, with an optional count per option. It draws the kit's
 * one segmented control (DESIGN.md, council round 10 A3): the raised track at the control height, items inset 3px, and
 * the selected item the one segment thumb with its label at 550, which never moves its neighbours.
 */
export const SegmentedFilter = <Id extends string>(props: {
  readonly label: string
  readonly options: readonly SegmentedFilterOption<Id>[]
  readonly value: Id
  readonly onChange: (next: Id) => void
  /** The data attribute each option carries for tests and journeys (`data-origin-option="dsh"`). */
  readonly optionAttribute: `data-${string}`
  readonly fill?: boolean
  /** 12px labels and tighter items, for a filter heading a narrow list (the Settings column). */
  readonly dense?: boolean
}): JSX.Element => (
  <div
    aria-label={props.label}
    className={cn(
      'dshx:h-(--dshx-control-h) dshx:items-center dshx:rounded-lg dshx:bg-muted dshx:p-[3px]',
      props.fill === true ? 'dshx:flex dshx:w-full' : 'dshx:inline-flex dshx:shrink-0',
    )}
    role="group"
  >
    {props.options.map(option => {
      const active = props.value === option.id
      return (
        <button
          aria-pressed={active}
          className={cn(
            'dshx:inline-flex dshx:h-full dshx:cursor-pointer dshx:items-center dshx:justify-center dshx:rounded-md dshx:border dshx:border-transparent dshx:font-medium dshx:whitespace-nowrap',
            props.dense === true ? 'dshx:gap-1 dshx:px-1.5 dshx:text-xs' : 'dshx:gap-1.5 dshx:px-2 dshx:text-sm',
            props.fill === true && 'dshx:min-w-0 dshx:flex-1',
            active
              ? 'dshx:segment-thumb dshx:font-selected dshx:text-foreground'
              : 'dshx:bg-transparent dshx:text-muted-foreground dshx:hover:text-foreground',
          )}
          {...{ [props.optionAttribute]: option.id }}
          key={option.id}
          onClick={() => props.onChange(option.id)}
          type="button"
        >
          <span className="dshx:segment-label" data-label={option.label}>
            {option.label}
          </span>
          {option.count !== undefined && <span className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground dshx:tabular-nums">{option.count}</span>}
        </button>
      )
    })}
  </div>
)
