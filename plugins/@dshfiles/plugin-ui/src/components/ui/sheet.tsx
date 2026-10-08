import * as React from "react"
import { cn } from "../../lib/utils.js"
import { XIcon } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "dshx:fixed dshx:inset-0 dshx:z-50 dshx:bg-black/50 dshx:data-[state=closed]:animate-out dshx:data-[state=closed]:fade-out-0 dshx:data-[state=open]:animate-in dshx:data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "dshx:fixed dshx:z-50 dshx:flex dshx:flex-col dshx:gap-4 dshx:bg-background dshx:shadow-lg dshx:transition dshx:ease-in-out dshx:data-[state=closed]:animate-out dshx:data-[state=closed]:duration-300 dshx:data-[state=open]:animate-in dshx:data-[state=open]:duration-500",
          side === "right" &&
            "dshx:inset-y-0 dshx:right-0 dshx:h-full dshx:w-3/4 dshx:border-l dshx:data-[state=closed]:slide-out-to-right dshx:data-[state=open]:slide-in-from-right dshx:sm:max-w-sm",
          side === "left" &&
            "dshx:inset-y-0 dshx:left-0 dshx:h-full dshx:w-3/4 dshx:border-r dshx:data-[state=closed]:slide-out-to-left dshx:data-[state=open]:slide-in-from-left dshx:sm:max-w-sm",
          side === "top" &&
            "dshx:inset-x-0 dshx:top-0 dshx:h-auto dshx:border-b dshx:data-[state=closed]:slide-out-to-top dshx:data-[state=open]:slide-in-from-top",
          side === "bottom" &&
            "dshx:inset-x-0 dshx:bottom-0 dshx:h-auto dshx:border-t dshx:data-[state=closed]:slide-out-to-bottom dshx:data-[state=open]:slide-in-from-bottom",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close className="dshx:absolute dshx:top-4 dshx:right-4 dshx:rounded-xs dshx:opacity-70 dshx:ring-offset-background dshx:transition-opacity dshx:hover:opacity-100 dshx:focus:ring-2 dshx:focus:ring-ring dshx:focus:ring-offset-2 dshx:focus:outline-hidden dshx:disabled:pointer-events-none dshx:data-[state=open]:bg-secondary">
            <XIcon className="dshx:size-4" />
            <span className="dshx:sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("dshx:flex dshx:flex-col dshx:gap-1.5 dshx:p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("dshx:mt-auto dshx:flex dshx:flex-col dshx:gap-2 dshx:p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("dshx:font-semibold dshx:text-foreground", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("dshx:text-sm dshx:text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
