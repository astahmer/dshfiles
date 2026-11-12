import { forwardRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'
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
  // A menu trigger (Pane options) gets `aria-expanded` from its menu. While that menu is open the tooltip stays shut: it
  // would cover the menu and, as the newest layer, take the Escape meant to close the menu.
  const [hinted, setHinted] = useState(false)
  const expanded = props['aria-expanded'] === true || props['aria-expanded'] === 'true'
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip open={hinted && !expanded} onOpenChange={setHinted}>
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
