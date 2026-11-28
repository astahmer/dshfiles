import * as React from 'react'
import { cn } from '../../lib/utils.js'

export interface AttentionBadgeProps extends Omit<React.ComponentPropsWithoutRef<'span'>, 'children'> {
  /** How many items wait on the user. A zero draws nothing (DESIGN.md › Layout › Counts). */
  readonly count: number
  /** What a screen reader hears after the number, once. */
  readonly label?: string
  /** The largest number drawn before it reads `<max>+`. */
  readonly max?: number
}

/**
 * The attention badge (council round 4 A3): a Needs-you count on a nav glyph or a tab. A 16px pill in the attention fill
 * with a 2px ring in the surface it sits on (`--dshx-badge-ring`, the rail's panel step by default). Seat it beside the
 * glyph, in a trailing corner, never over it.
 */
export const AttentionBadge = React.forwardRef<HTMLSpanElement, AttentionBadgeProps>(function AttentionBadge(
  { count, label = 'Needs you', max = 99, className, ...props },
  ref,
) {
  if (count <= 0) return null
  return (
    <span ref={ref} data-slot="attention-badge" className={cn('dshx:badge-attention', className)} {...props}>
      {count > max ? `${max}+` : count}
      <span className="dshx:sr-only"> {label}</span>
    </span>
  )
})
