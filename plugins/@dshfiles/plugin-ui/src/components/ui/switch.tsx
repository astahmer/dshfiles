'use client'

import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { Switch as SwitchPrimitive } from 'radix-ui'

function Switch({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: 'sm' | 'default'
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        'dshx:peer dshx:group/switch dshx:inline-flex dshx:shrink-0 dshx:items-center dshx:rounded-full dshx:border dshx:border-transparent dshx:shadow-xs dshx:transition-[background-color,transform] dshx:duration-(--dshx-duration-fade) dshx:outline-none dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-not-allowed dshx:disabled:opacity-50 dshx:data-[size=default]:h-[1.15rem] dshx:data-[size=default]:w-8 dshx:data-[size=sm]:h-3.5 dshx:data-[size=sm]:w-6 dshx:aria-checked:bg-control-on dshx:aria-[checked=false]:bg-input dshx:dark:aria-[checked=false]:bg-input/80 dshx:enabled:aria-[checked=false]:border-field-border',
        className,
      )}
      {...props}
    >
      {/* The track keys on `aria-checked`, not `data-state` (council picker round 1, C2): a Tooltip, Popover or menu
          trigger wrapped around the switch with `asChild` writes its own `data-state` ("closed") onto the root, so a
          `data-[state=checked]` track never drew. The thumb keeps its own `data-state`, which no trigger touches. */}
      {/* On is the ink track (DESIGN.md › Colour roles, `control-on`) with a background knob in both schemes, so the
          knob's side and the fill say on; off keeps a dim knob on a dark track in dark mode. An enabled off track draws
          the 1px field border in its own (already transparent) border box, so it reads as a control; a disabled one
          keeps no edge (council round 8 A3). */}
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'dshx:pointer-events-none dshx:block dshx:rounded-full dshx:bg-background dshx:ring-0 dshx:transition-transform dshx:duration-(--dshx-duration-fade) dshx:group-data-[size=default]/switch:size-4 dshx:group-data-[size=sm]/switch:size-3 dshx:data-[state=checked]:translate-x-[calc(100%-2px)] dshx:data-[state=unchecked]:translate-x-0 dshx:dark:data-[state=unchecked]:bg-muted-foreground',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
