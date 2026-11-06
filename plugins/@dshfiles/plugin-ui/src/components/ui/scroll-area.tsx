'use client'

import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui'

function ScrollArea({ className, children, ...props }: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    // A flex column, so the viewport fills whatever height the root gets, including a flexed `flex-1 min-h-0` size
    // inside a max-height column, where a `height: 100%` viewport never resolves and the content spills out unclipped.
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn('dshx:relative dshx:flex dshx:flex-col', className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="dshx:min-h-0 dshx:w-full dshx:flex-1 dshx:rounded-[inherit] dshx:transition-[color,box-shadow] dshx:outline-none dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({ className, orientation = 'vertical', ...props }: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'dshx:flex dshx:touch-none dshx:p-px dshx:transition-colors dshx:select-none',
        orientation === 'vertical' && 'dshx:h-full dshx:w-2.5 dshx:border-l dshx:border-l-transparent',
        orientation === 'horizontal' && 'dshx:h-2.5 dshx:flex-col dshx:border-t dshx:border-t-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb data-slot="scroll-area-thumb" className="dshx:relative dshx:flex-1 dshx:rounded-full dshx:bg-border" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
