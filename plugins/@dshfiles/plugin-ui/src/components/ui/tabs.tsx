import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'
import { Tabs as TabsPrimitive } from 'radix-ui'

function Tabs({ className, orientation = 'horizontal', ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn('dshx:group/tabs dshx:flex dshx:gap-2 dshx:data-[orientation=horizontal]:flex-col', className)}
      {...props}
    />
  )
}

/**
 * The segmented root (`default`) takes the one control height (council round 5 A1: `--dshx-control-h`, 32px, 44px on a
 * coarse pointer) with its items inset 3px, so it lines up with the fields and buttons beside it. `line` keeps 32px.
 * Its track is the raised step (`bg-muted`: #EBE9E7 light, #23201D dark) and the selected item the one segment thumb
 * (council round 10 A3: `segment-thumb`, its label at 550).
 */
const tabsListVariants = cva(
  'dshx:group/tabs-list dshx:inline-flex dshx:w-fit dshx:items-center dshx:justify-center dshx:rounded-lg dshx:p-[3px] dshx:text-muted-foreground dshx:group-data-[orientation=vertical]/tabs:h-fit dshx:group-data-[orientation=vertical]/tabs:flex-col dshx:data-[variant=line]:rounded-none',
  {
    variants: {
      variant: {
        default: 'dshx:bg-muted dshx:group-data-[orientation=horizontal]/tabs:h-(--dshx-control-h)',
        line: 'dshx:gap-1 dshx:bg-transparent dshx:group-data-[orientation=horizontal]/tabs:h-8',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function TabsList({ className, variant = 'default', ...props }: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return <TabsPrimitive.List data-slot="tabs-list" data-variant={variant} className={cn(tabsListVariants({ variant }), className)} {...props} />
}

/**
 * A plain-text label is wrapped in a `segment-label` span, so a segmented item keeps its 550 width at rest and selecting
 * it never moves its neighbours (council round 10 A3). Any other children render as given.
 */
function TabsTrigger({ className, children, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'dshx:relative dshx:inline-flex dshx:h-full dshx:flex-1 dshx:items-center dshx:justify-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-transparent dshx:px-2 dshx:py-1 dshx:text-sm dshx:font-medium dshx:whitespace-nowrap dshx:text-muted-foreground dshx:transition-all dshx:group-data-[orientation=vertical]/tabs:w-full dshx:group-data-[orientation=vertical]/tabs:justify-start dshx:hover:text-foreground dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:focus-visible:outline-1 dshx:focus-visible:outline-ring dshx:disabled:pointer-events-none dshx:disabled:opacity-50 dshx:group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none dshx:dark:hover:text-foreground dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4',
        'dshx:group-data-[variant=line]/tabs-list:bg-transparent dshx:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent dshx:dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent dshx:dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent',
        // The selected segment (council round 10 A3): one thumb in both schemes, its label the ink at 550.
        'dshx:data-[state=active]:text-foreground dshx:group-data-[variant=default]/tabs-list:data-[state=active]:segment-thumb dshx:group-data-[variant=default]/tabs-list:data-[state=active]:font-selected',
        'dshx:after:absolute dshx:after:bg-foreground dshx:after:opacity-0 dshx:after:transition-opacity dshx:group-data-[orientation=horizontal]/tabs:after:inset-x-0 dshx:group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] dshx:group-data-[orientation=horizontal]/tabs:after:h-0.5 dshx:group-data-[orientation=vertical]/tabs:after:inset-y-0 dshx:group-data-[orientation=vertical]/tabs:after:-right-1 dshx:group-data-[orientation=vertical]/tabs:after:w-0.5 dshx:group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100',
        className,
      )}
      {...props}
    >
      {typeof children === 'string' ? <SegmentLabel label={children} /> : children}
    </TabsPrimitive.Trigger>
  )
}

/** A segment's text label that reserves the width of its selected (550) form (`segment-label`, council round 10 A3). */
function SegmentLabel({ label, className }: { readonly label: string; readonly className?: string }) {
  return (
    <span data-slot="segment-label" data-label={label} className={cn('dshx:segment-label', className)}>
      {label}
    </span>
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content data-slot="tabs-content" className={cn('dshx:flex-1 dshx:outline-none dshx:data-[state=inactive]:hidden!', className)} {...props} />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, SegmentLabel, tabsListVariants }
