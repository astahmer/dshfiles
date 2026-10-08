import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils.js"

const alertVariants = cva(
  "dshx:relative dshx:grid dshx:w-full dshx:grid-cols-[0_1fr] dshx:items-start dshx:gap-y-0.5 dshx:rounded-lg dshx:border dshx:px-4 dshx:py-3 dshx:text-sm dshx:has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] dshx:has-[>svg]:gap-x-3 dshx:[&>svg]:size-4 dshx:[&>svg]:translate-y-0.5 dshx:[&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "dshx:bg-card dshx:text-card-foreground",
        destructive:
          "dshx:bg-card dshx:text-destructive dshx:*:data-[slot=alert-description]:text-destructive/90 dshx:[&>svg]:text-current",
        info: "dshx:border-info/30 dshx:bg-info/10 dshx:[&>svg]:text-info",
        success: "dshx:border-success/30 dshx:bg-success/10 dshx:[&>svg]:text-success",
        warning: "dshx:border-warning/40 dshx:bg-warning/10 dshx:[&>svg]:text-warning",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "dshx:col-start-2 dshx:line-clamp-1 dshx:min-h-4 dshx:font-medium dshx:tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "dshx:col-start-2 dshx:grid dshx:justify-items-start dshx:gap-1 dshx:text-sm dshx:text-muted-foreground dshx:[&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription }
