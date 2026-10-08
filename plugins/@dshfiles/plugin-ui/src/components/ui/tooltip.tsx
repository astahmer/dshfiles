import * as React from "react"
import { cn } from "../../lib/utils"
import { Tooltip as TooltipPrimitive } from "radix-ui"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "dshx:z-50 dshx:w-fit dshx:origin-(--radix-tooltip-content-transform-origin) dshx:animate-in dshx:rounded-md dshx:bg-foreground dshx:px-3 dshx:py-1.5 dshx:text-xs dshx:text-balance dshx:text-background dshx:fade-in-0 dshx:zoom-in-95 dshx:data-[side=bottom]:slide-in-from-top-2 dshx:data-[side=left]:slide-in-from-right-2 dshx:data-[side=right]:slide-in-from-left-2 dshx:data-[side=top]:slide-in-from-bottom-2 dshx:data-[state=closed]:animate-out dshx:data-[state=closed]:fade-out-0 dshx:data-[state=closed]:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="dshx:z-50 dshx:size-2.5 dshx:translate-y-[calc(-50%_-_2px)] dshx:rotate-45 dshx:rounded-[2px] dshx:bg-foreground dshx:fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
