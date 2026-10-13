import { cn } from '../../lib/utils.js'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('dshx:animate-pulse dshx:rounded-md dshx:bg-accent', className)} {...props} />
}

export { Skeleton }
