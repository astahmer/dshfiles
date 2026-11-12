import { cn } from '../../lib/utils.js'
import { useOffscreenPause } from '../../hooks/offscreen-pause.js'

/** A loading placeholder; its pulse pauses while scrolled off screen and stops under reduced motion. */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  const ref = useOffscreenPause<HTMLDivElement>()
  return (
    <div
      ref={ref}
      data-slot="skeleton"
      className={cn('dshx:animate-pulse dshx:motion-reduce:animate-none dshx:rounded-md dshx:bg-accent', className)}
      {...props}
    />
  )
}

export { Skeleton }
