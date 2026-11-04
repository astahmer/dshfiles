import * as React from 'react'
import { animate, motionSafe, springs } from '../../motion/index.js'
import { usePrefersReducedMotion } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'

export interface RollingNumberProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  readonly value: number
  /** Turns the number into text; defaults to locale-grouped integers. Only digits roll; other glyphs swap. */
  readonly format?: (value: number) => string
}

/**
 * A number whose changed digits roll vertically: the old digit slides up and out while the new one rises in.
 * Counters, costs, tab counts. Keeps tabular widths so nothing around it shifts. Screen readers get the plain text.
 */
export function RollingNumber({ value, format = defaultFormat, className, ...props }: RollingNumberProps) {
  const text = format(value)
  const previous = React.useRef(text)
  const direction = React.useRef<1 | -1>(1)
  const last = React.useRef(value)
  if (last.current !== value) {
    direction.current = value >= last.current ? 1 : -1
    last.current = value
  }
  const before = previous.current
  React.useEffect(() => {
    previous.current = text
  }, [text])
  // Align from the right so units and the ones digit line up while the number grows.
  const width = Math.max(before.length, text.length)
  const next = text.padStart(width, ' ')
  const old = before.padStart(width, ' ')
  return (
    <span className={cn('dshx:inline-flex dshx:tabular-nums', className)} {...props}>
      <span className="dshx:sr-only">{text}</span>
      <span aria-hidden className="dshx:inline-flex">
        {Array.from(next).map((char, index) =>
          char === ' ' ? null : <RollingChar key={width - index} char={char} from={old[index] ?? ' '} direction={direction.current} />,
        )}
      </span>
    </span>
  )
}

function RollingChar({ char, from, direction }: { readonly char: string; readonly from: string; readonly direction: 1 | -1 }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const prevRef = React.useRef<HTMLSpanElement>(null)
  const changed = char !== from && from !== ' '
  React.useLayoutEffect(() => {
    if (!changed || ref.current == null || prevRef.current == null) return
    const offset = direction === 1 ? '100%' : '-100%'
    const back = direction === 1 ? '-100%' : '100%'
    const a = animate(ref.current, { transform: [`translateY(${offset})`, 'translateY(0%)'], opacity: [0, 1] }, motionSafe(springs.snappy))
    const b = animate(prevRef.current, { transform: ['translateY(0%)', `translateY(${back})`], opacity: [1, 0] }, motionSafe(springs.snappy))
    return () => {
      a.complete()
      b.complete()
    }
  }, [char, changed, direction])
  return (
    <span className="dshx:relative dshx:inline-block dshx:overflow-hidden">
      <span ref={ref} className="dshx:inline-block">
        {char}
      </span>
      {changed ? (
        <span ref={prevRef} className="dshx:absolute dshx:inset-0 dshx:inline-block dshx:opacity-0">
          {from}
        </span>
      ) : null}
    </span>
  )
}

const defaultFormat = (value: number) => Math.round(value).toLocaleString()

export interface ShimmerTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Sweep while true; stops on the plain colour when false. */
  readonly active?: boolean
  /** Seconds per sweep. */
  readonly duration?: number
}

/**
 * Text with a highlight band sweeping through it: the in-progress step label ("Searching for …"), a live status.
 * Falls back to plain muted text under reduced motion.
 */
export function ShimmerText({ active = true, duration = 1.6, className, style, children, ...props }: ShimmerTextProps) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const reduced = usePrefersReducedMotion()
  const on = active && !reduced
  React.useEffect(() => {
    if (!on || ref.current == null) return
    const controls = animate(ref.current, { backgroundPositionX: ['100%', '0%'] }, { duration, ease: 'linear', repeat: Infinity })
    return () => controls.stop()
  }, [on, duration])
  return (
    <span
      ref={ref}
      className={cn(on ? 'dshx:bg-clip-text dshx:text-transparent' : 'dshx:text-muted-foreground', className)}
      style={
        on
          ? {
              backgroundImage:
                'linear-gradient(90deg, var(--dsw-alias-label-secondary) 0%, var(--dsw-alias-label-secondary) 40%, var(--dsw-alias-label-primary) 50%, var(--dsw-alias-label-secondary) 60%, var(--dsw-alias-label-secondary) 100%)',
              backgroundSize: '250% 100%',
              ...style,
            }
          : style
      }
      {...props}
    >
      {children}
    </span>
  )
}

export interface TypewriterProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  readonly text: string
  /** Seconds per character. */
  readonly speed?: number
  readonly caret?: boolean
  readonly onDone?: () => void
}

/** Types `text` in one character at a time with an optional blinking caret: streamed replies, agent edits. */
export function Typewriter({ text, speed = 0.03, caret = true, onDone, className, ...props }: TypewriterProps) {
  const [shown, setShown] = React.useState(0)
  const reduced = usePrefersReducedMotion()
  const caretRef = React.useRef<HTMLSpanElement>(null)
  const done = React.useRef(onDone)
  done.current = onDone
  React.useEffect(() => {
    if (reduced) {
      setShown(text.length)
      done.current?.()
      return
    }
    setShown(0)
    const controls = animate(0, text.length, {
      duration: text.length * speed,
      ease: 'linear',
      onUpdate: value => setShown(Math.floor(value)),
      onComplete: () => {
        setShown(text.length)
        done.current?.()
      },
    })
    return () => controls.stop()
  }, [text, speed, reduced])
  React.useEffect(() => {
    if (!caret || reduced || caretRef.current == null) return
    const controls = animate(caretRef.current, { opacity: [1, 1, 0, 0] }, { duration: 1.06, times: [0, 0.5, 0.5, 1], repeat: Infinity, ease: 'linear' })
    return () => controls.stop()
  }, [caret, reduced])
  return (
    <span className={className} {...props}>
      <span className="dshx:sr-only">{text}</span>
      <span aria-hidden>{text.slice(0, shown)}</span>
      {caret ? (
        <span ref={caretRef} aria-hidden className="dshx:ml-px dshx:inline-block dshx:h-[1em] dshx:w-px dshx:translate-y-[0.15em] dshx:bg-current" />
      ) : null}
    </span>
  )
}
