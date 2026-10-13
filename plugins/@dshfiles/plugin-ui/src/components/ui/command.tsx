import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { cn } from '../../lib/utils.js'
import { SearchIcon } from 'lucide-react'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog.js'

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'dshx:flex dshx:h-full dshx:w-full dshx:flex-col dshx:overflow-hidden dshx:rounded-md dshx:bg-popover dshx:text-popover-foreground',
        className,
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = 'Command Palette',
  description = 'Search for a command to run...',
  children,
  className,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="dshx:sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent className={cn('dshx:overflow-hidden dshx:p-0', className)} showCloseButton={showCloseButton}>
        <Command className="dshx:**:data-[slot=command-input-wrapper]:h-12 dshx:[&_[cmdk-group-heading]]:px-2 dshx:[&_[cmdk-group-heading]]:font-medium dshx:[&_[cmdk-group-heading]]:text-muted-foreground dshx:[&_[cmdk-group]]:px-2 dshx:[&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 dshx:[&_[cmdk-input-wrapper]_svg]:h-5 dshx:[&_[cmdk-input-wrapper]_svg]:w-5 dshx:[&_[cmdk-input]]:h-12 dshx:[&_[cmdk-item]]:px-2 dshx:[&_[cmdk-item]]:py-3 dshx:[&_[cmdk-item]_svg]:h-5 dshx:[&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="dshx:flex dshx:h-8 dshx:items-center dshx:gap-2 dshx:border-b dshx:px-3">
      <SearchIcon className="dshx:size-4 dshx:shrink-0 dshx:opacity-50" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'dshx:flex dshx:h-10 dshx:w-full dshx:rounded-md dshx:bg-transparent dshx:py-3 dshx:text-sm dshx:outline-hidden dshx:placeholder:text-muted-foreground dshx:disabled:cursor-not-allowed dshx:disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn('dshx:max-h-[300px] dshx:scroll-py-1 dshx:overflow-x-hidden dshx:overflow-y-auto', className)}
      {...props}
    />
  )
}

function CommandEmpty({ ...props }: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty data-slot="command-empty" className="dshx:py-6 dshx:text-center dshx:text-sm" {...props} />
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'dshx:overflow-hidden dshx:p-1 dshx:text-foreground dshx:[&_[cmdk-group-heading]]:px-2 dshx:[&_[cmdk-group-heading]]:py-1.5 dshx:[&_[cmdk-group-heading]]:text-xs dshx:[&_[cmdk-group-heading]]:font-medium dshx:[&_[cmdk-group-heading]]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return <CommandPrimitive.Separator data-slot="command-separator" className={cn('dshx:-mx-1 dshx:h-px dshx:bg-border', className)} {...props} />
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'dshx:relative dshx:flex dshx:cursor-default dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:px-2 dshx:py-1.5 dshx:text-sm dshx:outline-hidden dshx:select-none dshx:data-[disabled=true]:pointer-events-none dshx:data-[disabled=true]:opacity-50 dshx:data-[selected=true]:bg-accent dshx:data-[selected=true]:text-accent-foreground dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4 dshx:[&_svg:not([class*=text-])]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="command-shortcut" className={cn('dshx:ml-auto dshx:text-xs dshx:tracking-widest dshx:text-muted-foreground', className)} {...props} />
}

export { Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut, CommandSeparator }
