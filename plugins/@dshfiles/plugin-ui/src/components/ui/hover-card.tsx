import * as React from "react"
import { cn } from "../../lib/utils.js"
import { HoverCard as HoverCardPrimitive } from "radix-ui"

function HoverCard({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return (
    <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
  )
}

function HoverCardContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal data-slot="hover-card-portal">
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "dshx:z-50 dshx:w-64 dshx:origin-(--radix-hover-card-content-transform-origin) dshx:rounded-md dshx:border dshx:bg-popover dshx:p-4 dshx:text-popover-foreground dshx:shadow-md dshx:outline-hidden dshx:data-[side=bottom]:slide-in-from-top-2 dshx:data-[side=left]:slide-in-from-right-2 dshx:data-[side=right]:slide-in-from-left-2 dshx:data-[side=top]:slide-in-from-bottom-2 dshx:data-[state=closed]:animate-out dshx:data-[state=closed]:fade-out-0 dshx:data-[state=closed]:zoom-out-95 dshx:data-[state=open]:animate-in dshx:data-[state=open]:fade-in-0 dshx:data-[state=open]:zoom-in-95",
          className
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
