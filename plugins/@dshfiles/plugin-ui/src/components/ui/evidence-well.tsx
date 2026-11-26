import * as React from 'react'
import { cn } from '../../lib/utils.js'

/** `neutral` for what an item will do ("Runs: <command>"); `danger` for a failed turn's error line. */
export type EvidenceWellTone = 'neutral' | 'danger'

export interface EvidenceWellProps extends React.ComponentProps<'div'> {
  readonly tone?: EvidenceWellTone
  /** A short lead-in ("Runs:", "Error:") in secondary ink, or the danger tone in a danger well. */
  readonly label?: React.ReactNode
}

/**
 * The evidence well (DESIGN.md › Evidence well, council round 16 A1): the one recipe for what an Inbox card body quotes,
 * desktop and phone. Full measure, padding 8/12, radius 6, mono 12/18 that wraps, on a warm neutral or red-soft fill;
 * plainly not a button (no height, border or shadow). Render a danger well only when there is an error line to show.
 * Without the component, `dshx:evidence-well` with `data-tone="danger"` and a `data-evidence-label` span is the same.
 */
export function EvidenceWell({ tone = 'neutral', label, className, children, ...props }: EvidenceWellProps): React.JSX.Element {
  return (
    <div data-slot="evidence-well" data-tone={tone} className={cn('dshx:evidence-well', className)} {...props}>
      {label === undefined ? null : (
        <>
          <span data-evidence-label="">{label}</span>{' '}
        </>
      )}
      {children}
    </div>
  )
}
