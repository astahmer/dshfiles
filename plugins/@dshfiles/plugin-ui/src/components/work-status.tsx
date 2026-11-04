import * as React from 'react'
import { CheckIcon, DiamondIcon, Loader2Icon, XIcon } from 'lucide-react'
import { cn } from '../lib/utils.js'

/**
 * The one status vocabulary for every work item (thread, subagent, job, check, workspace, host), from the ADE plan
 * §4.7. Plugins map their own states onto these six and may add detail text, never a new colour.
 */
export const workStatusValues = ['working', 'needs-you', 'failed', 'ready', 'idle', 'done'] as const

export type WorkStatus = (typeof workStatusValues)[number]

/** Default English labels; pass translated ones through `label`/`labels` where a plugin localizes. */
export const workStatusLabels = {
  working: 'Working',
  'needs-you': 'Needs you',
  failed: 'Failed',
  ready: 'Ready',
  idle: 'Idle',
  done: 'Done',
} as const satisfies Record<WorkStatus, string>

export const WorkStatusModel = {
  values: workStatusValues,
  isWorkStatus: (value: string): value is WorkStatus => workStatusValues.some(status => status === value),
  label: (status: WorkStatus): string => workStatusLabels[status],
  /** Dark cockpit: only these two states ask for the user's eye. Working is colourless on purpose. */
  isAttention: (status: WorkStatus): boolean => status === 'needs-you' || status === 'failed',
  /** Rows whose title is bold (finished, not yet seen or landed). */
  isEmphasized: (status: WorkStatus): boolean => status === 'ready',
  /** Rows whose title is muted (landed, closed, released). */
  isMuted: (status: WorkStatus): boolean => status === 'done',
} as const

export interface StatusGlyphProps extends Omit<React.ComponentPropsWithoutRef<'span'>, 'children'> {
  readonly status: WorkStatus
  /** Accessible name; defaults to the English label. Ignored when `decorative`. */
  readonly label?: string
  /** Hide from assistive technology when the row already names its state in text. */
  readonly decorative?: boolean
}

const glyphClass = {
  working: 'dshx:text-muted-foreground',
  'needs-you': 'dshx:text-info',
  failed: 'dshx:text-destructive',
  ready: 'dshx:text-foreground',
  idle: '',
  done: 'dshx:text-muted-foreground',
} as const satisfies Record<WorkStatus, string>

const GlyphMark = ({ status }: { readonly status: WorkStatus }): React.JSX.Element | null => {
  switch (status) {
    case 'working':
      return <Loader2Icon aria-hidden className="dshx:size-3.5 dshx:animate-spin dshx:motion-reduce:animate-none" />
    case 'needs-you':
      return <DiamondIcon aria-hidden className="dshx:size-3 dshx:fill-current" strokeWidth={2.5} />
    case 'failed':
      return <XIcon aria-hidden className="dshx:size-3.5" strokeWidth={3} />
    case 'ready':
      return <span aria-hidden className="dshx:size-2 dshx:rounded-full dshx:bg-current" />
    case 'idle':
      return null
    case 'done':
      return <CheckIcon aria-hidden className="dshx:size-3.5" strokeWidth={2.5} />
  }
}

/**
 * The status mark of a work item, in a fixed 16 px box so rows align whatever the state. Working spins without
 * colour; needs-you is the accent diamond; failed the danger cross; ready a solid dot; idle draws nothing; done a
 * muted check.
 */
export const StatusGlyph = React.forwardRef<HTMLSpanElement, StatusGlyphProps>(function StatusGlyph(
  { status, label, decorative = false, className, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      data-slot="status-glyph"
      data-status={status}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : (label ?? workStatusLabels[status])}
      aria-hidden={decorative ? true : undefined}
      className={cn('dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center', glyphClass[status], className)}
      {...props}
    >
      <GlyphMark status={status} />
    </span>
  )
})
