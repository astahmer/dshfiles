import { cn } from '../../lib/utils.js'
import { useOffscreenPause } from '../../hooks/offscreen-pause.js'
import { Loader2Icon } from 'lucide-react'

/** A loading spinner; it pauses while scrolled off screen and stops under reduced motion. */
function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  const ref = useOffscreenPause<SVGSVGElement>()
  return (
    <Loader2Icon
      ref={ref}
      role="status"
      aria-label="Loading"
      className={cn('dshx:size-4 dshx:animate-spin dshx:motion-reduce:animate-none', className)}
      {...props}
    />
  )
}

export { Spinner }
