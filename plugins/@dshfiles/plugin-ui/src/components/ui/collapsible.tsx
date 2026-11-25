'use client'

import { ChevronRightIcon } from 'lucide-react'
import * as React from 'react'
import { Collapsible as CollapsiblePrimitive } from 'radix-ui'
import { cn } from '../../lib/utils.js'

function Collapsible({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return <CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />
}

function CollapsibleContent({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return <CollapsiblePrimitive.CollapsibleContent data-slot="collapsible-content" {...props} />
}

/**
 * The disclosure chevron (council round 5 A5): 16px, secondary ink, a quarter turn when its `group/disclosure` trigger
 * is open. Use it inside your own trigger only; `DisclosureTrigger` already draws one.
 */
function DisclosureChevron({ className }: { readonly className?: string }) {
  return (
    <ChevronRightIcon
      aria-hidden="true"
      data-slot="disclosure-chevron"
      className={cn(
        'dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground dshx:transition-transform dshx:duration-(--dshx-duration-fade) dshx:ease-enter dshx:group-data-[state=open]/disclosure:rotate-90 dshx:motion-reduce:transition-none',
        className,
      )}
    />
  )
}

/**
 * The one disclosure (council round 5 A5): a `Collapsible` trigger with the chevron first, then its label. Never the
 * native ▶ marker; a `<details>` takes the `dshx:disclosure` utility (disclosure.css) for the same look. The kit
 * sheet draws its focus ring (a kit control slot).
 */
const DisclosureTrigger = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleTrigger>>(
  function DisclosureTrigger({ className, children, ...props }, ref) {
    return (
      <CollapsiblePrimitive.CollapsibleTrigger
        ref={ref}
        data-slot="collapsible-trigger"
        className={cn(
          'dshx:group/disclosure dshx:inline-flex dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:text-sm dshx:font-medium dshx:text-foreground dshx:disabled:pointer-events-none dshx:disabled:opacity-50',
          className,
        )}
        {...props}
      >
        <DisclosureChevron />
        {children}
      </CollapsiblePrimitive.CollapsibleTrigger>
    )
  },
)

export { Collapsible, CollapsibleTrigger, CollapsibleContent, DisclosureTrigger, DisclosureChevron }
