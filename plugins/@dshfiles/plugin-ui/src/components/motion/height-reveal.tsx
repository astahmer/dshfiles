import * as React from 'react'
import { animate, durations, easings, motionSafe, springs } from '../../motion/index.js'
import { cn } from '../../lib/utils.js'

export interface HeightRevealProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly open: boolean
}

/**
 * Expands to its content's height when `open` turns true and collapses (then unmounts) when it turns false.
 * The disclosure body behind expandable steps, test files and run logs. Instant under reduced motion.
 */
export function HeightReveal({ open, className, children, ...props }: HeightRevealProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [present, setPresent] = React.useState(open)
  const mounted = React.useRef(false)
  if (open && !present) setPresent(true)

  React.useLayoutEffect(() => {
    const element = ref.current
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (element == null) return
    let cancelled = false
    if (open) {
      const target = element.scrollHeight
      const controls = animate(element, { height: [0, target], opacity: [0, 1] }, motionSafe(springs.smooth))
      void controls.finished.then(() => {
        if (!cancelled) element.style.height = ''
      })
      return () => {
        cancelled = true
        controls.stop()
      }
    }
    const from = element.getBoundingClientRect().height
    const controls = animate(element, { height: [from, 0], opacity: [1, 0] }, motionSafe({ duration: durations.fast, ease: easings.in }))
    void controls.finished.then(() => {
      if (!cancelled) setPresent(false)
    })
    return () => {
      cancelled = true
      controls.stop()
    }
  }, [open])

  if (!present) return null
  return (
    <div ref={ref} className={cn('dshx:overflow-hidden', className)} aria-hidden={open ? undefined : true} {...props}>
      {children}
    </div>
  )
}
