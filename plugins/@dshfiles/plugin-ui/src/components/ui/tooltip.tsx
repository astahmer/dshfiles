import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { KeyHint } from './kbd.js'
import { Tooltip as TooltipPrimitive } from 'radix-ui'

/**
 * A tooltip waits 400ms, so passing the pointer over a toolbar does not flash labels, and its neighbours then open at
 * once for 300ms. A surface that must label instantly (a dense icon rail) passes its own `delayDuration`.
 */
function TooltipProvider({ delayDuration = 400, skipDelayDuration = 300, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} {...props} />
}

const NO_HOVER = '(hover: none)'

const noHoverQuery = (): MediaQueryList | undefined => (typeof window === 'undefined' || !(window.matchMedia instanceof Function) ? undefined : window.matchMedia(NO_HOVER))

const subscribeNoHover = (onChange: () => void): (() => void) => {
  const query = noHoverQuery()
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

const readNoHover = (): boolean => noHoverQuery()?.matches === true
const serverNoHover = (): boolean => false

/**
 * Where nothing can hover (`(hover: none)`: a phone, a tablet without a pointer) a tooltip does not open by itself: a tap
 * focuses its trigger, or WebKit replays it as a hover, and the label then stays over the content it was meant to explain
 * (round four, item 4). An owner that controls `open` still decides.
 */
function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const noHover = React.useSyncExternalStore(subscribeNoHover, readNoHover, serverNoHover)
  if (noHover && props.open === undefined) return <TooltipPrimitive.Root data-slot="tooltip" {...props} open={false} />
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  keys,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
  /** The key that runs the control's verb (a dshx `Command` key spec), shown after the label. */
  keys?: string | readonly string[]
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'dshx:z-[1100] dshx:w-fit dshx:origin-(--radix-tooltip-content-transform-origin) dshx:animate-in dshx:rounded-md dshx:bg-foreground dshx:px-3 dshx:py-1.5 dshx:text-xs dshx:text-balance dshx:text-background dshx:fade-in-0 dshx:zoom-in-95 dshx:data-[side=bottom]:slide-in-from-top-2 dshx:data-[side=left]:slide-in-from-right-2 dshx:data-[side=right]:slide-in-from-left-2 dshx:data-[side=top]:slide-in-from-bottom-2 dshx:data-[state=closed]:animate-out dshx:data-[state=closed]:fade-out-0 dshx:data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      >
        {keys === undefined ? (
          children
        ) : (
          <span className="dshx:inline-flex dshx:items-center dshx:gap-2">
            {children}
            <KeyHint keys={keys} />
          </span>
        )}
        <TooltipPrimitive.Arrow className="dshx:z-[1100] dshx:size-2.5 dshx:translate-y-[calc(-50%_-_2px)] dshx:rotate-45 dshx:rounded-xs dshx:bg-foreground dshx:fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
