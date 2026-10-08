import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:items-center dshx:justify-center dshx:gap-6 dshx:rounded-lg dshx:border-dashed dshx:p-6 dshx:text-center dshx:text-balance dshx:md:p-12",
        className
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn(
        "dshx:flex dshx:max-w-sm dshx:flex-col dshx:items-center dshx:gap-2 dshx:text-center",
        className
      )}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  "dshx:mb-2 dshx:flex dshx:shrink-0 dshx:items-center dshx:justify-center dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "dshx:bg-transparent",
        icon: "dshx:flex dshx:size-10 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-lg dshx:bg-muted dshx:text-foreground dshx:[&_svg:not([class*=size-])]:size-6",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn("dshx:text-lg dshx:font-medium dshx:tracking-tight", className)}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "dshx:text-sm/relaxed dshx:text-muted-foreground dshx:[&>a]:underline dshx:[&>a]:underline-offset-4 dshx:[&>a:hover]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "dshx:flex dshx:w-full dshx:max-w-sm dshx:min-w-0 dshx:flex-col dshx:items-center dshx:gap-4 dshx:text-sm dshx:text-balance",
        className
      )}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
}
