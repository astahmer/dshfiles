import { cn } from "../../lib/utils.js"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "dshx:pointer-events-none dshx:inline-flex dshx:h-5 dshx:w-fit dshx:min-w-5 dshx:items-center dshx:justify-center dshx:gap-1 dshx:rounded-sm dshx:bg-muted dshx:px-1 dshx:font-sans dshx:text-xs dshx:font-medium dshx:text-muted-foreground dshx:select-none",
        "dshx:[&_svg:not([class*=size-])]:size-3",
        "dshx:[[data-slot=tooltip-content]_&]:bg-background/20 dshx:[[data-slot=tooltip-content]_&]:text-background dshx:dark:[[data-slot=tooltip-content]_&]:bg-background/10",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("dshx:inline-flex dshx:items-center dshx:gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
