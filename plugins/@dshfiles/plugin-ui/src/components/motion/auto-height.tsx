import * as React from 'react'
import { animate, motionSafe, springs, type AnimationOptions, type AnimationPlaybackControls } from '../../motion/index.js'
import { cn } from '../../lib/utils.js'

export interface AutoHeightProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Spring or tween for the height change; defaults to `springs.smooth`. */
  readonly transition?: AnimationOptions
  /** Class for the measured inner box. */
  readonly innerClassName?: string
}

/**
 * A box whose height follows its content with a spring instead of jumping: expanding substeps, a card that changes
 * shape, a list that grows. Measures with a ResizeObserver, so any content change animates. Reduced motion snaps.
 */
export function AutoHeight({ transition = springs.smooth, innerClassName, className, children, ...props }: AutoHeightProps) {
  const outerRef = React.useRef<HTMLDivElement>(null)
  const innerRef = React.useRef<HTMLDivElement>(null)
  const transitionRef = React.useRef(transition)
  transitionRef.current = transition

  React.useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (outer == null || inner == null || typeof ResizeObserver === 'undefined') return
    let last = inner.offsetHeight
    let running: AnimationPlaybackControls | null = null
    const observer = new ResizeObserver(() => {
      const next = inner.offsetHeight
      if (next === last) return
      // Layout height, not the client rect: an ancestor's pop-in scale must not skew the start value.
      const from = running == null ? last : outer.offsetHeight
      last = next
      running?.stop()
      const controls = animate(outer, { height: [`${from}px`, `${next}px`] }, motionSafe(transitionRef.current))
      running = controls
      void controls.finished.then(() => {
        if (running !== controls) return
        running = null
        outer.style.height = ''
      })
    })
    observer.observe(inner)
    return () => {
      observer.disconnect()
      running?.stop()
    }
  }, [])

  return (
    <div ref={outerRef} className={cn('dshx:overflow-hidden', className)} {...props}>
      <div ref={innerRef} className={cn('dshx:flow-root', innerClassName)}>
        {children}
      </div>
    </div>
  )
}
