import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "dshx:group/tabs dshx:flex dshx:gap-2 dshx:data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "dshx:group/tabs-list dshx:inline-flex dshx:w-fit dshx:items-center dshx:justify-center dshx:rounded-lg dshx:p-[3px] dshx:text-muted-foreground dshx:group-data-[orientation=horizontal]/tabs:h-8 dshx:group-data-[orientation=vertical]/tabs:h-fit dshx:group-data-[orientation=vertical]/tabs:flex-col dshx:data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "dshx:bg-muted",
        line: "dshx:gap-1 dshx:bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "dshx:relative dshx:inline-flex dshx:h-[calc(100%-1px)] dshx:flex-1 dshx:items-center dshx:justify-center dshx:gap-1.5 dshx:rounded-md dshx:border dshx:border-transparent dshx:px-2 dshx:py-1 dshx:text-sm dshx:font-medium dshx:whitespace-nowrap dshx:text-foreground/60 dshx:transition-all dshx:group-data-[orientation=vertical]/tabs:w-full dshx:group-data-[orientation=vertical]/tabs:justify-start dshx:hover:text-foreground dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:focus-visible:outline-1 dshx:focus-visible:outline-ring dshx:disabled:pointer-events-none dshx:disabled:opacity-50 dshx:group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm dshx:group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none dshx:dark:text-muted-foreground dshx:dark:hover:text-foreground dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4",
        "dshx:group-data-[variant=line]/tabs-list:bg-transparent dshx:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent dshx:dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent dshx:dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent",
        "dshx:data-[state=active]:bg-background dshx:data-[state=active]:text-foreground dshx:dark:data-[state=active]:border-input dshx:dark:data-[state=active]:bg-input/30 dshx:dark:data-[state=active]:text-foreground",
        "dshx:after:absolute dshx:after:bg-foreground dshx:after:opacity-0 dshx:after:transition-opacity dshx:group-data-[orientation=horizontal]/tabs:after:inset-x-0 dshx:group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] dshx:group-data-[orientation=horizontal]/tabs:after:h-0.5 dshx:group-data-[orientation=vertical]/tabs:after:inset-y-0 dshx:group-data-[orientation=vertical]/tabs:after:-right-1 dshx:group-data-[orientation=vertical]/tabs:after:w-0.5 dshx:group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("dshx:flex-1 dshx:outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
