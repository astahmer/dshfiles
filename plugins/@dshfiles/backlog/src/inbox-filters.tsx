import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import type { InboxFilter } from './inbox-model.js'

const filters: readonly { readonly value: InboxFilter; readonly label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs-input', label: 'Needs you' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'suggestions', label: 'Suggestions' },
  { value: 'overdue', label: 'Overdue' },
]

/** A filter over one list, so a toggle group: one Tab stop, arrow keys between filters, and a filter cannot be cleared. */
export const InboxFilters = (props: {
  readonly filter: InboxFilter
  readonly countOf: (filter: InboxFilter) => number
  readonly onChange: (filter: InboxFilter) => void
}): JSX.Element => (
  <ToggleGroup
    aria-label="Inbox filters"
    className="dshx:h-10 dshx:w-full dshx:shrink-0 dshx:overflow-x-auto dshx:overflow-y-hidden dshx:border-b dshx:border-border dshx:px-3 dshx:[scrollbar-width:none] dshx:[&::-webkit-scrollbar]:hidden"
    onValueChange={next => {
      const entry = filters.find(candidate => candidate.value === next)
      if (entry !== undefined) props.onChange(entry.value)
    }}
    size="sm"
    spacing={1}
    type="single"
    value={props.filter}
  >
    {filters.map(entry => (
      <ToggleGroupItem className="dshx:gap-1 dshx:text-[13px]" key={entry.value} value={entry.value}>
        {entry.label}
        {props.countOf(entry.value) === 0 ? null : <span className="dshx:text-[11px] dshx:text-muted-foreground">{props.countOf(entry.value)}</span>}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
)
