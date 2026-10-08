"use client"

import * as React from "react"
import { cn } from "../../lib/utils.js"
import { Separator as SeparatorPrimitive } from "radix-ui"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "dshx:shrink-0 dshx:bg-border dshx:data-[orientation=horizontal]:h-px dshx:data-[orientation=horizontal]:w-full dshx:data-[orientation=vertical]:h-full dshx:data-[orientation=vertical]:w-px",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
