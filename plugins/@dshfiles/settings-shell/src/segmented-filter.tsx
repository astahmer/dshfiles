import { cn } from '@dshfiles/plugin-ui/lib/utils'

export interface SegmentedFilterOption<Id extends string> {
  readonly id: Id
  readonly label: string
  readonly count?: number | undefined
}

/** A row of pressed/unpressed buttons that picks one filter value, with an optional count per option. */
export const SegmentedFilter = <Id extends string>(props: {
  readonly label: string
  readonly options: readonly SegmentedFilterOption<Id>[]
  readonly value: Id
  readonly onChange: (next: Id) => void
  /** The data attribute each option carries for tests and journeys (`data-origin-option="dsh"`). */
  readonly optionAttribute: `data-${string}`
  readonly fill?: boolean
}): JSX.Element => (
  <div
    aria-label={props.label}
    className={cn(
      'dshx:items-center dshx:gap-0.5 dshx:rounded-lg dshx:border dshx:border-border/70 dshx:bg-muted/80 dshx:p-0.5',
      props.fill === true ? 'dshx:flex' : 'dshx:inline-flex dshx:shrink-0',
    )}
    role="group"
  >
    {props.options.map(option => {
      const active = props.value === option.id
      return (
        <button
          aria-pressed={active}
          className={cn(
            'dshx:inline-flex dshx:h-6 dshx:cursor-pointer dshx:items-center dshx:justify-center dshx:gap-1 dshx:rounded-md dshx:border-none dshx:px-2 dshx:text-xs dshx:whitespace-nowrap dshx:transition-colors dshx:duration-100',
            props.fill === true && 'dshx:min-w-0 dshx:flex-1',
            active
              ? 'dshx:bg-background dshx:font-medium dshx:text-foreground dshx:shadow-s1'
              : 'dshx:bg-transparent dshx:font-normal dshx:text-muted-foreground dshx:hover:text-foreground',
          )}
          {...{ [props.optionAttribute]: option.id }}
          key={option.id}
          onClick={() => props.onChange(option.id)}
          type="button"
        >
          <span>{option.label}</span>
          {option.count !== undefined && (
            <span className={cn('dshx:text-2xs dshx:tabular-nums', active ? 'dshx:text-muted-foreground' : 'dshx:text-muted-foreground/75')}>
              {option.count}
            </span>
          )}
        </button>
      )
    })}
  </div>
)
