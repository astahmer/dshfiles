import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils.js"
import { Toggle as TogglePrimitive } from "radix-ui"

const toggleVariants = cva(
  "dshx:inline-flex dshx:items-center dshx:justify-center dshx:gap-2 dshx:rounded-md dshx:text-sm dshx:font-medium dshx:whitespace-nowrap dshx:transition-[color,box-shadow] dshx:outline-none dshx:hover:bg-muted dshx:hover:text-muted-foreground dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:disabled:pointer-events-none dshx:disabled:opacity-50 dshx:aria-invalid:border-destructive dshx:aria-invalid:ring-destructive/20 dshx:data-[state=on]:bg-accent dshx:data-[state=on]:text-accent-foreground dshx:dark:aria-invalid:ring-destructive/40 dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "dshx:bg-transparent",
        outline:
          "dshx:border dshx:border-input dshx:bg-transparent dshx:shadow-xs dshx:hover:bg-accent dshx:hover:text-accent-foreground",
      },
      size: {
        default: "dshx:h-8 dshx:min-w-8 dshx:px-2",
        sm: "dshx:h-7 dshx:min-w-7 dshx:px-1.5",
        lg: "dshx:h-10 dshx:min-w-10 dshx:px-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
