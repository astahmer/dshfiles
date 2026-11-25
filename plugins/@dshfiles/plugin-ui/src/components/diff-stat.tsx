import * as React from 'react'
import { cn } from '../lib/utils.js'

/**
 * A change count, `+48 −3` (council round 3 A6): one reading for every diff summary, file header, tool row and pill.
 * Always both sides, additions first; sans with tabular figures at the 12px meta size (13px on a phone), so counts
 * line up in a column. Additions are the success colour and deletions the danger colour, both AA as text on bg, panel,
 * raised and the selected wash; a zero side is muted, since nothing changed there. The minus is U+2212, not a hyphen.
 * A screen reader hears "48 lines added, 3 lines removed" (or `label`), never the signs.
 */
export interface DiffStatProps extends Omit<React.ComponentProps<'span'>, 'children'> {
  readonly added: number
  readonly removed: number
  /** What a screen reader hears instead of the default "N lines added, M lines removed". */
  readonly label?: string
}

const count = new Intl.NumberFormat('en-US')
const lines = (n: number): string => `${count.format(n)} ${n === 1 ? 'line' : 'lines'}`

function DiffStat({ added, removed, label, className, ...props }: DiffStatProps) {
  return (
    <span data-slot="diff-stat" className={cn('dshx:inline-flex dshx:items-baseline dshx:gap-1 dshx:font-sans dshx:text-xs dshx:tabular-nums dshx:whitespace-nowrap', className)} {...props}>
      <span aria-hidden="true" className="dshx:contents">
        <span data-diff-side="added" className={added > 0 ? 'dshx:text-success' : 'dshx:text-muted-foreground'}>
          +{count.format(added)}
        </span>
        <span data-diff-side="removed" className={removed > 0 ? 'dshx:text-destructive' : 'dshx:text-muted-foreground'}>
          {'\u2212'}
          {count.format(removed)}
        </span>
      </span>
      <span className="dshx:sr-only">{label ?? `${lines(added)} added, ${lines(removed)} removed`}</span>
    </span>
  )
}

export { DiffStat }
