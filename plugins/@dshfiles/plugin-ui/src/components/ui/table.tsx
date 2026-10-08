"use client"

import * as React from "react"
import { cn } from "../../lib/utils.js"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="dshx:relative dshx:w-full dshx:overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("dshx:w-full dshx:caption-bottom dshx:text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("dshx:[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("dshx:[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "dshx:border-t dshx:bg-muted/50 dshx:font-medium dshx:[&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "dshx:border-b dshx:transition-colors dshx:hover:bg-muted/50 dshx:has-aria-expanded:bg-muted/50 dshx:data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "dshx:h-10 dshx:px-2 dshx:text-left dshx:align-middle dshx:font-medium dshx:whitespace-nowrap dshx:text-foreground dshx:[&:has([role=checkbox])]:pr-0 dshx:[&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "dshx:p-2 dshx:align-middle dshx:whitespace-nowrap dshx:[&:has([role=checkbox])]:pr-0 dshx:[&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("dshx:mt-4 dshx:text-sm dshx:text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
