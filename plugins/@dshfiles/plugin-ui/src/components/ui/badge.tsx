import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils.js"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "dshx:inline-flex dshx:w-fit dshx:shrink-0 dshx:items-center dshx:justify-center dshx:gap-1 dshx:overflow-hidden dshx:rounded-full dshx:border dshx:border-transparent dshx:px-2 dshx:py-0.5 dshx:text-xs dshx:font-medium dshx:whitespace-nowrap dshx:transition-[color,box-shadow] dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:aria-invalid:border-destructive dshx:aria-invalid:ring-destructive/20 dshx:dark:aria-invalid:ring-destructive/40 dshx:[&>svg]:pointer-events-none dshx:[&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "dshx:bg-primary dshx:text-primary-foreground dshx:[a&]:hover:bg-primary/90",
        secondary:
          "dshx:bg-secondary dshx:text-secondary-foreground dshx:[a&]:hover:bg-secondary/90",
        destructive:
          "dshx:bg-destructive dshx:text-white dshx:focus-visible:ring-destructive/20 dshx:dark:bg-destructive/60 dshx:dark:focus-visible:ring-destructive/40 dshx:[a&]:hover:bg-destructive/90",
        outline:
          "dshx:border-border dshx:text-foreground dshx:[a&]:hover:bg-accent dshx:[a&]:hover:text-accent-foreground",
        ghost: "dshx:[a&]:hover:bg-accent dshx:[a&]:hover:text-accent-foreground",
        link: "dshx:text-primary dshx:underline-offset-4 dshx:[a&]:hover:underline",
        info: "dshx:bg-info/15 dshx:text-info",
        success: "dshx:bg-success/15 dshx:text-success",
        warning: "dshx:bg-warning/15 dshx:text-warning",
        muted: "dshx:bg-muted dshx:text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
