import * as React from "react"
import { cn } from "../../lib/utils"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { Button } from "./button"

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "dshx:fixed dshx:inset-0 dshx:z-50 dshx:bg-black/50 dshx:data-[state=closed]:animate-out dshx:data-[state=closed]:fade-out-0 dshx:data-[state=open]:animate-in dshx:data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  size?: "default" | "sm"
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          "dshx:group/alert-dialog-content dshx:fixed dshx:top-[50%] dshx:left-[50%] dshx:z-50 dshx:grid dshx:w-full dshx:max-w-[calc(100%-2rem)] dshx:translate-x-[-50%] dshx:translate-y-[-50%] dshx:gap-4 dshx:rounded-lg dshx:border dshx:bg-background dshx:p-6 dshx:shadow-lg dshx:duration-200 dshx:data-[size=sm]:max-w-xs dshx:data-[state=closed]:animate-out dshx:data-[state=closed]:fade-out-0 dshx:data-[state=closed]:zoom-out-95 dshx:data-[state=open]:animate-in dshx:data-[state=open]:fade-in-0 dshx:data-[state=open]:zoom-in-95 dshx:data-[size=default]:sm:max-w-lg",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "dshx:grid dshx:grid-rows-[auto_1fr] dshx:place-items-center dshx:gap-1.5 dshx:text-center dshx:has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] dshx:has-data-[slot=alert-dialog-media]:gap-x-6 dshx:sm:group-data-[size=default]/alert-dialog-content:place-items-start dshx:sm:group-data-[size=default]/alert-dialog-content:text-left dshx:sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "dshx:flex dshx:flex-col-reverse dshx:gap-2 dshx:group-data-[size=sm]/alert-dialog-content:grid dshx:group-data-[size=sm]/alert-dialog-content:grid-cols-2 dshx:sm:flex-row dshx:sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "dshx:text-lg dshx:font-semibold dshx:sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("dshx:text-sm dshx:text-muted-foreground", className)}
      {...props}
    />
  )
}

function AlertDialogMedia({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "dshx:mb-2 dshx:inline-flex dshx:size-16 dshx:items-center dshx:justify-center dshx:rounded-md dshx:bg-muted dshx:sm:group-data-[size=default]/alert-dialog-content:row-span-2 dshx:*:[svg:not([class*=size-])]:size-8",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Action
        data-slot="alert-dialog-action"
        className={cn(className)}
        {...props}
      />
    </Button>
  )
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Cancel
        data-slot="alert-dialog-cancel"
        className={cn(className)}
        {...props}
      />
    </Button>
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
