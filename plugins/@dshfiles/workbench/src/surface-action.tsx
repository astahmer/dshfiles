import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'

/** Surface-width collapse: keep the action name accessible when its visual label becomes an icon. */
export const SurfaceAction = forwardRef<
  HTMLButtonElement,
  Omit<ComponentPropsWithoutRef<typeof Button>, 'children'> & {
    readonly label: string
    readonly icon: ReactNode
    readonly iconOnly?: boolean
  }
>(function SurfaceAction({ label, icon, iconOnly = false, ...props }, ref) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" size="sm" variant="ghost" aria-label={label} {...props} ref={ref}>
            {icon}
            <span className={cn(iconOnly ? 'dshx:sr-only' : 'dshx:@max-pane-compact:sr-only')}>{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
})
