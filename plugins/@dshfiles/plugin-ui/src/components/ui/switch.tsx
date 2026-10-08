"use client"

import * as React from "react"
import { cn } from "../../lib/utils"
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "dshx:peer dshx:group/switch dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:rounded-full dshx:border dshx:border-transparent dshx:shadow-xs dshx:transition-all dshx:outline-none dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-not-allowed dshx:disabled:opacity-50 dshx:data-[size=default]:h-[1.15rem] dshx:data-[size=default]:w-8 dshx:data-[size=sm]:h-3.5 dshx:data-[size=sm]:w-6 dshx:data-[state=checked]:bg-primary dshx:data-[state=unchecked]:bg-input dshx:dark:data-[state=unchecked]:bg-input/80",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "dshx:pointer-events-none dshx:block dshx:rounded-full dshx:bg-background dshx:ring-0 dshx:transition-transform dshx:group-data-[size=default]/switch:size-4 dshx:group-data-[size=sm]/switch:size-3 dshx:data-[state=checked]:translate-x-[calc(100%-2px)] dshx:data-[state=unchecked]:translate-x-0 dshx:dark:data-[state=checked]:bg-primary-foreground dshx:dark:data-[state=unchecked]:bg-foreground"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
