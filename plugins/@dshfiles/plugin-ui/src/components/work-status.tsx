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
  /** `small` draws the mark in a 10px seat for a count chip (`StatusCount`); rows keep the 16px seat. */
  readonly size?: 'default' | 'small'
}

/**
 * DESIGN.md › Colour roles: the two attention states keep their hues (indigo Needs you, red Failed), Ready is the green
 * result dot, Working is an ink ring whose motion says it, and the rest are greys.
 */
const glyphClass = {
  working: 'dshx:text-status-working',
  'needs-you': 'dshx:text-info',
  failed: 'dshx:text-destructive',
  ready: 'dshx:text-status-ready',
  idle: 'dshx:text-(--dsw-alias-label-tertiary)',
  done: 'dshx:text-muted-foreground',
  stale: 'dshx:text-(--dsw-alias-label-tertiary)',
  stopped: 'dshx:text-muted-foreground',
} as const satisfies Record<StatusGlyphState, string>

/** One revolution; every spinner on the page shares this phase so a list of working rows turns in step. */
export const STATUS_SPINNER_PERIOD_MS = 900

/** The working mark: a faint ring with a turning arc, phase-locked to the page clock and paused off screen. */
const Spinner = ({ small }: { readonly small: boolean }): React.JSX.Element => {
  const ref = useOffscreenPause<SVGSVGElement>()
  // A negative delay equal to the page clock modulo the period starts every spinner at the same angle.
  const [delay] = React.useState(() => `-${String(Math.round((typeof performance === 'undefined' ? 0 : performance.now()) % STATUS_SPINNER_PERIOD_MS))}ms`)
  return (
    <svg
      ref={ref}
      aria-hidden
      viewBox="0 0 16 16"
      data-glyph-spinner=""
      className={cn(small ? 'dshx:size-2.5' : 'dshx:size-3.5', 'dshx:animate-spin dshx:motion-reduce:animate-none')}
      style={{ animationDelay: delay, animationDuration: `${String(STATUS_SPINNER_PERIOD_MS)}ms` }}
      fill="none"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.75" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

/** Mark sizes per seat: the 16px row seat (round five K6) and the 10px count-chip seat (round five A6). */
const markSize = {
  default: { mark: 'dshx:size-3.5', dot: 'dshx:size-2.5', ring: 'dshx:size-2' },
  small: { mark: 'dshx:size-2.5', dot: 'dshx:size-1.5', ring: 'dshx:size-1.5' },
} as const

const GlyphMark = ({ status, size }: { readonly status: StatusGlyphState; readonly size: keyof typeof markSize }): React.JSX.Element => {
  const { mark, dot, ring } = markSize[size]
  switch (status) {
    case 'working':
      return <Spinner small={size === 'small'} />
    case 'needs-you':
      return (
        <svg aria-hidden viewBox="0 0 16 16" className={mark}>
          <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )
    case 'failed':
      return <XIcon aria-hidden className={mark} strokeWidth={3} />
    case 'ready':
      return <span aria-hidden className={cn(dot, 'dshx:rounded-full dshx:bg-current')} />
    case 'idle':
      return <span aria-hidden className={cn(ring, 'dshx:rounded-full dshx:border dshx:border-current')} />
    case 'done':
      return <CheckIcon aria-hidden className={mark} strokeWidth={2.5} />
    case 'stale':
      return <span aria-hidden className={cn(dot, 'dshx:rounded-full dshx:border dshx:border-dashed dshx:border-current')} />
    case 'stopped':
      return <span aria-hidden className={cn(ring, 'dshx:rounded-xs dshx:bg-current')} />
  }
}

/** The 120ms cross-fade of a mark that replaced another while on screen (opacity only under reduced motion). */
const markEnter = 'dshx:animate-in dshx:fade-in-0 dshx:zoom-in-80 dshx:duration-(--dshx-duration-fade) dshx:ease-enter'

/**
 * Whether the glyph has changed status since it mounted. The previous status is kept from the last render, so a row
 * that mounts already Ready (a virtualised row scrolling back in) draws its mark at once instead of replaying a change.
 */
function useChangedWhileMounted(status: StatusGlyphState): boolean {
  const [seen, setSeen] = React.useState({ status, changed: false })
  if (seen.status !== status) {
    setSeen({ status, changed: true })
    return true
  }
  return seen.changed
}

/**
 * The status mark of a work item, in a fixed 16 px box so rows align whatever the state (StatusGlyph v2). The marks that
 * carry a state you act on read at 14 px (needs-you, failed, working) and the ready dot at 10 px (round five K6): working is
 * an ink phase-synced spinner, needs-you the indigo diamond, failed the red cross, ready a green dot, idle a faint
 * ring, done a muted check, stale a dashed ring, stopped a muted square. A mark that changes while on screen
 * cross-fades in 120ms.
 */
export const StatusGlyph = React.forwardRef<HTMLSpanElement, StatusGlyphProps>(function StatusGlyph(
  { status, label, decorative = false, size = 'default', className, ...props },
  ref,
) {
  const changed = useChangedWhileMounted(status)
  return (
    <span
      ref={ref}
      data-slot="status-glyph"
      data-status={status}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : (label ?? glyphLabels[status])}
      aria-hidden={decorative ? true : undefined}
      className={cn('dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:justify-center', size === 'small' ? 'dshx:size-2.5' : 'dshx:size-4', glyphClass[status], className)}
      {...props}
    >
      <span key={status} data-glyph-mark="" className={cn('dshx:inline-flex dshx:items-center dshx:justify-center', changed && markEnter)}>
        <GlyphMark status={status} size={size} />
      </span>
    </span>
  )
})

export interface StatusCountProps extends Omit<React.ComponentPropsWithoutRef<'span'>, 'children'> {
  readonly status: StatusGlyphState
  readonly count: number
  /**
   * What a screen reader hears after the number, and the whole text when it starts with the number; defaults to the
   * English status label ("3 Needs you"). Pass a translated or more specific one ("2 failed threads").
   */
  readonly label?: string
}

/** Needs you and Failed take their tint pair; every other state is a muted chip. */
const countTint = (status: StatusGlyphState): string =>
  status === 'needs-you'
    ? 'dshx:bg-attention-tint dshx:text-attention-foreground'
    : status === 'failed'
      ? 'dshx:bg-danger-tint dshx:text-danger-tint-foreground'
      : 'dshx:bg-muted dshx:text-muted-foreground'

/**
 * A status count chip (round five A6): the status glyph at 10px beside a tabular number, so a coloured count still
 * reads without its colour. Needs you and Failed sit at the tint rung of their hue; every other state is a muted chip
 * with its grey or green glyph. A zero draws nothing (DESIGN.md › Layout › Counts). Use it for a group header's count,
 * a page title's count of what waits on you, a tab or filter count that names a status.
 */
export const StatusCount = React.forwardRef<HTMLSpanElement, StatusCountProps>(function StatusCount({ status, count, label, className, ...props }, ref) {
  if (count <= 0) return null
  const number = String(count)
  const spoken = label ?? glyphLabels[status]
  const rest = spoken.startsWith(`${number} `) ? spoken.slice(number.length + 1) : spoken
  return (
    <span
      ref={ref}
      data-slot="status-count"
      data-status={status}
      className={cn(
        'dshx:inline-flex dshx:h-4.5 dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:rounded-full dshx:px-1.5 dshx:text-2xs dshx:leading-none dshx:font-medium dshx:tabular-nums',
        countTint(status),
        className,
      )}
      {...props}
    >
      <StatusGlyph status={status} size="small" decorative />
      {number}
      <span className="dshx:sr-only"> {rest}</span>
    </span>
  )
})
