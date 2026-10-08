"use client"

import * as React from "react"
import { cn } from "../../lib/utils.js"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("dshx:relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="dshx:size-full dshx:rounded-[inherit] dshx:transition-[color,box-shadow] dshx:outline-none dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "dshx:flex dshx:touch-none dshx:p-px dshx:transition-colors dshx:select-none",
        orientation === "vertical" &&
          "dshx:h-full dshx:w-2.5 dshx:border-l dshx:border-l-transparent",
        orientation === "horizontal" &&
          "dshx:h-2.5 dshx:flex-col dshx:border-t dshx:border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="dshx:relative dshx:flex-1 dshx:rounded-full dshx:bg-border"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
