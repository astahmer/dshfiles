import * as React from 'react'
import { CheckIcon, XIcon } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { useOffscreenPause } from '../hooks/offscreen-pause.js'

/**
 * The one status vocabulary for every work item (thread, subagent, job, check, workspace, host), from the ADE plan
 * §4.7. Plugins map their own states onto these six and may add detail text, never a new colour.
 */
export const workStatusValues = ['working', 'needs-you', 'failed', 'ready', 'idle', 'done'] as const

export type WorkStatus = (typeof workStatusValues)[number]

/**
 * Glyph-only states beside the six statuses (visual refresh T1.1): `stale` (a reading or workspace that may be
 * out of date) and `stopped` (cancelled or parked by the user). They draw, they never group or sort.
 */
export const glyphOnlyStateValues = ['stale', 'stopped'] as const

export type StatusGlyphState = WorkStatus | (typeof glyphOnlyStateValues)[number]

/** Default English labels; pass translated ones through `label`/`labels` where a plugin localizes. */
export const workStatusLabels = {
  working: 'Working',
  'needs-you': 'Needs you',
  failed: 'Failed',
  ready: 'Ready',
  idle: 'Idle',
  done: 'Done',
} as const satisfies Record<WorkStatus, string>

const glyphLabels = { ...workStatusLabels, stale: 'Stale', stopped: 'Stopped' } as const satisfies Record<StatusGlyphState, string>

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
  readonly status: StatusGlyphState
  /** Accessible name; defaults to the English label. Ignored when `decorative`. */
  readonly label?: string
  /** Hide from assistive technology when the row already names its state in text. */
  readonly decorative?: boolean
}

/** Colour lives here only for the two attention states (indigo Needs you, red Failed); the rest are greys. */
const glyphClass = {
  working: 'dshx:text-muted-foreground',
  'needs-you': 'dshx:text-info',
  failed: 'dshx:text-destructive',
  ready: 'dshx:text-foreground',
  idle: 'dshx:text-(--dsw-alias-label-tertiary)',
  done: 'dshx:text-muted-foreground',
  stale: 'dshx:text-(--dsw-alias-label-tertiary)',
  stopped: 'dshx:text-muted-foreground',
} as const satisfies Record<StatusGlyphState, string>

/** One revolution; every spinner on the page shares this phase so a list of working rows turns in step. */
export const STATUS_SPINNER_PERIOD_MS = 900

/** The working mark: a faint ring with a turning arc, phase-locked to the page clock and paused off screen. */
const Spinner = (): React.JSX.Element => {
  const ref = useOffscreenPause<SVGSVGElement>()
  // A negative delay equal to the page clock modulo the period starts every spinner at the same angle.
  const [delay] = React.useState(() => `-${String(Math.round((typeof performance === 'undefined' ? 0 : performance.now()) % STATUS_SPINNER_PERIOD_MS))}ms`)
  return (
    <svg
      ref={ref}
      aria-hidden
      viewBox="0 0 16 16"
      data-glyph-spinner=""
      className="dshx:size-3.5 dshx:animate-spin dshx:motion-reduce:animate-none"
      style={{ animationDelay: delay, animationDuration: `${String(STATUS_SPINNER_PERIOD_MS)}ms` }}
      fill="none"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

const GlyphMark = ({ status }: { readonly status: StatusGlyphState }): React.JSX.Element => {
  switch (status) {
    case 'working':
      return <Spinner />
    case 'needs-you':
      return (
        <svg aria-hidden viewBox="0 0 16 16" className="dshx:size-3">
          <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )
    case 'failed':
      return <XIcon aria-hidden className="dshx:size-3.5" strokeWidth={3} />
    case 'ready':
      return <span aria-hidden className="dshx:size-2 dshx:rounded-full dshx:bg-current" />
    case 'idle':
      return <span aria-hidden className="dshx:size-2 dshx:rounded-full dshx:border dshx:border-current" />
    case 'done':
      return <CheckIcon aria-hidden className="dshx:size-3.5" strokeWidth={2.5} />
    case 'stale':
      return <span aria-hidden className="dshx:size-2.5 dshx:rounded-full dshx:border dshx:border-dashed dshx:border-current" />
    case 'stopped':
      return <span aria-hidden className="dshx:size-2 dshx:rounded-xs dshx:bg-current" />
  }
}

/**
 * The status mark of a work item, in a fixed 16 px box so rows align whatever the state (StatusGlyph v2): working is
 * a colourless phase-synced spinner, needs-you the indigo diamond, failed the red cross, ready a solid dot, idle a
 * faint ring, done a muted check, stale a dashed ring, stopped a muted square.
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
      aria-label={decorative ? undefined : (label ?? glyphLabels[status])}
      aria-hidden={decorative ? true : undefined}
      className={cn('dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center', glyphClass[status], className)}
      {...props}
    >
      <GlyphMark status={status} />
    </span>
  )
})
