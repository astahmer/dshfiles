import * as React from 'react'
import { animate, drawStroke, durations, easings, motionSafe, presets, springs, type AnimationPlaybackControls } from '../../motion/index.js'
import { usePrefersReducedMotion } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'

export type StepGlyphStatus = 'done' | 'running' | 'active' | 'pending' | 'waiting' | 'attention' | 'locked' | 'failed'

export interface StepGlyphProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  readonly status: StepGlyphStatus
  readonly size?: 'sm' | 'default'
  /** Colour of done/running/active: the brand primary, success green or info blue. */
  readonly tone?: 'primary' | 'success' | 'info'
  /** `solid` fills the done disc; `outline` draws a ring with the check inside. */
  readonly variant?: 'solid' | 'outline'
  /** Play the change animation on first mount too (a step that arrives already done). */
  readonly appear?: boolean
  /** Accessible name; defaults to the status. */
  readonly label?: string
}

const defaultLabels = {
  done: 'Done',
  running: 'Running',
  active: 'In progress',
  pending: 'Not started',
  waiting: 'Waiting',
  attention: 'Needs attention',
  locked: 'Needs approval',
  failed: 'Failed',
} as const satisfies Record<StepGlyphStatus, string>

/**
 * The step status mark shared by plans, run logs and checklists: a check that pops and draws itself in when a step
 * finishes, a spinning arc while it runs, a pulsing ring for the current step, a hollow ring while pending.
 */
export const StepGlyph = React.forwardRef<HTMLSpanElement, StepGlyphProps>(function StepGlyph(
  { status, size = 'default', tone = 'primary', variant = 'solid', appear = false, label, className, ...props },
  ref,
) {
  const reduced = usePrefersReducedMotion()
  const bodyRef = React.useRef<HTMLSpanElement>(null)
  const checkRef = React.useRef<SVGPathElement>(null)
  const spinRef = React.useRef<HTMLSpanElement>(null)
  const haloRef = React.useRef<HTMLSpanElement>(null)
  const previous = React.useRef<StepGlyphStatus | null>(appear ? null : status)

  React.useLayoutEffect(() => {
    const from = previous.current
    previous.current = status
    if (from === status) return
    const running: AnimationPlaybackControls[] = []
    if (bodyRef.current != null) running.push(animate(bodyRef.current, presets.popIn, motionSafe(status === 'done' ? springs.bouncy : springs.snappy)))
    const check = checkRef.current
    if (status === 'done' && check != null) {
      const draw = drawStroke(check, { duration: durations.slow, delay: 0.06, ease: easings.out })
      void draw.finished.then(() => {
        check.style.strokeDasharray = ''
        check.style.strokeDashoffset = ''
      })
      running.push(draw)
    }
    return () => {
      for (const controls of running) controls.complete()
    }
  }, [status])

  React.useEffect(() => {
    if (reduced) return
    if (status === 'running' && spinRef.current != null) {
      const controls = animate(spinRef.current, { rotate: [0, 360] }, { duration: 0.9, ease: 'linear', repeat: Infinity })
      return () => controls.stop()
    }
    if (status === 'active' && haloRef.current != null) {
      const controls = animate(
        haloRef.current,
        { transform: ['scale(1)', 'scale(1.9)'], opacity: [0.45, 0] },
        { duration: 1.5, ease: easings.out, repeat: Infinity },
      )
      return () => controls.stop()
    }
    return undefined
  }, [status, reduced])

  const toneText = tone === 'success' ? 'dshx:text-success' : tone === 'info' ? 'dshx:text-info' : 'dshx:text-primary'
  const toneBg = tone === 'success' ? 'dshx:bg-success' : tone === 'info' ? 'dshx:bg-info' : 'dshx:bg-primary'

  return (
    <span
      ref={ref}
      role="img"
      aria-label={label ?? defaultLabels[status]}
      data-status={status}
      className={cn(
        'dshx:relative dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:justify-center',
        size === 'sm' ? 'dshx:size-3.5' : 'dshx:size-[18px]',
        className,
      )}
      {...props}
    >
      <span ref={bodyRef} aria-hidden className="dshx:relative dshx:inline-flex dshx:size-full dshx:items-center dshx:justify-center">
        {status === 'done' ? (
          <span
            className={cn(
              'dshx:inline-flex dshx:size-full dshx:items-center dshx:justify-center dshx:rounded-full',
              variant === 'solid' ? cn(toneBg, 'dshx:text-primary-foreground') : cn('dshx:border-[1.5px] dshx:border-current', toneText),
            )}
          >
            <svg viewBox="0 0 20 20" className="dshx:size-[70%]" fill="none">
              <path
                ref={checkRef}
                d="M5.5 10.5 8.6 13.4 14.5 7"
                stroke="currentColor"
                strokeWidth={variant === 'solid' ? 2.6 : 2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        ) : null}
        {status === 'running' ? (
          <span ref={spinRef} className={cn('dshx:inline-flex dshx:size-full', toneText)}>
            <svg viewBox="0 0 20 20" className="dshx:size-full" fill="none">
              <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeOpacity={0.18} strokeWidth="2.2" />
              <path d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </span>
        ) : null}
        {status === 'active' ? (
          <>
            <span ref={haloRef} className={cn('dshx:absolute dshx:inset-0 dshx:rounded-full dshx:opacity-0', toneBg)} />
            <span
              className={cn(
                'dshx:relative dshx:inline-flex dshx:size-full dshx:items-center dshx:justify-center dshx:rounded-full dshx:border-[1.5px] dshx:border-current dshx:bg-card',
                toneText,
              )}
            >
              <span className={cn('dshx:size-[40%] dshx:rounded-full', toneBg)} />
            </span>
          </>
        ) : null}
        {status === 'pending' ? <span className="dshx:size-full dshx:rounded-full dshx:border-[1.5px] dshx:border-muted-foreground/60 dshx:bg-card" /> : null}
        {status === 'waiting' ? (
          <span className="dshx:size-full dshx:rounded-full dshx:border-[1.5px] dshx:border-dashed dshx:border-muted-foreground/75" />
        ) : null}
        {status === 'attention' ? <span className="dshx:size-full dshx:rounded-full dshx:bg-warning" /> : null}
        {status === 'locked' ? (
          <span className="dshx:inline-flex dshx:size-full dshx:items-center dshx:justify-center dshx:rounded-full dshx:border-[1.5px] dshx:border-info dshx:text-info">
            <svg viewBox="0 0 20 20" className="dshx:size-[62%]" fill="currentColor">
              <rect x="5" y="9" width="10" height="7.5" rx="1.6" />
              <path d="M7.2 9V7.2a2.8 2.8 0 0 1 5.6 0V9" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </span>
        ) : null}
        {status === 'failed' ? (
          <span className="dshx:inline-flex dshx:size-full dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-destructive dshx:text-white">
            <svg viewBox="0 0 20 20" className="dshx:size-[62%]" fill="none">
              <path d="M6.5 6.5l7 7M13.5 6.5l-7 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </span>
        ) : null}
      </span>
    </span>
  )
})
