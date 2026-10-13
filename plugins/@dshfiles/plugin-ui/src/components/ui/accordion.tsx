'use client'

import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { ChevronDownIcon } from 'lucide-react'
import { Accordion as AccordionPrimitive } from 'radix-ui'

function Accordion({ ...props }: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />
}

function AccordionItem({ className, ...props }: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item data-slot="accordion-item" className={cn('dshx:border-b dshx:last:border-b-0', className)} {...props} />
}

function AccordionTrigger({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="dshx:flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          'dshx:flex dshx:flex-1 dshx:items-start dshx:justify-between dshx:gap-4 dshx:rounded-md dshx:py-4 dshx:text-left dshx:text-sm dshx:font-medium dshx:transition-all dshx:outline-none dshx:hover:underline dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:disabled:pointer-events-none dshx:disabled:opacity-50 dshx:[&[data-state=open]>svg]:rotate-180',
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="dshx:pointer-events-none dshx:size-4 dshx:shrink-0 dshx:translate-y-0.5 dshx:text-muted-foreground dshx:transition-transform dshx:duration-200" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({ className, children, ...props }: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="dshx:overflow-hidden dshx:text-sm dshx:data-[state=closed]:animate-accordion-up dshx:data-[state=open]:animate-accordion-down"
      {...props}
    >
      <div className={cn('dshx:pt-0 dshx:pb-4', className)}>{children}</div>
    </AccordionPrimitive.Content>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
