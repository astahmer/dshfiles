'use client'

import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'

function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({ className, sideOffset = 4, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'dshx:z-[1100] dshx:max-h-(--radix-dropdown-menu-content-available-height) dshx:min-w-[8rem] dshx:origin-(--radix-dropdown-menu-content-transform-origin) dshx:overflow-x-hidden dshx:overflow-y-auto dshx:rounded-md dshx:border dshx:bg-popover dshx:p-1 dshx:text-popover-foreground dshx:shadow-md dshx:data-[side=bottom]:slide-in-from-top-2 dshx:data-[side=left]:slide-in-from-right-2 dshx:data-[side=right]:slide-in-from-left-2 dshx:data-[side=top]:slide-in-from-bottom-2 dshx:data-[state=closed]:animate-out dshx:data-[state=closed]:fade-out-0 dshx:data-[state=closed]:zoom-out-95 dshx:data-[state=open]:animate-in dshx:data-[state=open]:fade-in-0 dshx:data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: 'default' | 'destructive'
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        'dshx:relative dshx:flex dshx:cursor-default dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:px-2 dshx:py-1.5 dshx:text-sm dshx:outline-hidden dshx:select-none dshx:focus:bg-accent dshx:focus:text-accent-foreground dshx:data-[disabled]:pointer-events-none dshx:data-[disabled]:opacity-50 dshx:data-[inset]:pl-8 dshx:data-[variant=destructive]:text-destructive dshx:data-[variant=destructive]:focus:bg-destructive/10 dshx:data-[variant=destructive]:focus:text-destructive dshx:dark:data-[variant=destructive]:focus:bg-destructive/20 dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4 dshx:[&_svg:not([class*=text-])]:text-muted-foreground dshx:data-[variant=destructive]:*:[svg]:text-destructive!',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({ className, children, checked, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        'dshx:relative dshx:flex dshx:cursor-default dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:py-1.5 dshx:pr-2 dshx:pl-8 dshx:text-sm dshx:outline-hidden dshx:select-none dshx:focus:bg-accent dshx:focus:text-accent-foreground dshx:data-[disabled]:pointer-events-none dshx:data-[disabled]:opacity-50 dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4',
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="dshx:pointer-events-none dshx:absolute dshx:left-2 dshx:flex dshx:size-3.5 dshx:items-center dshx:justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="dshx:size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

function DropdownMenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        'dshx:relative dshx:flex dshx:cursor-default dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:py-1.5 dshx:pr-2 dshx:pl-8 dshx:text-sm dshx:outline-hidden dshx:select-none dshx:focus:bg-accent dshx:focus:text-accent-foreground dshx:data-[disabled]:pointer-events-none dshx:data-[disabled]:opacity-50 dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    >
      <span className="dshx:pointer-events-none dshx:absolute dshx:left-2 dshx:flex dshx:size-3.5 dshx:items-center dshx:justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="dshx:size-2 dshx:fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn('dshx:px-2 dshx:py-1.5 dshx:text-sm dshx:font-medium dshx:data-[inset]:pl-8', className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('dshx:-mx-1 dshx:my-1 dshx:h-px dshx:bg-border', className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn('dshx:ml-auto dshx:text-xs dshx:tracking-widest dshx:text-muted-foreground', className)}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        'dshx:flex dshx:cursor-default dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:px-2 dshx:py-1.5 dshx:text-sm dshx:outline-hidden dshx:select-none dshx:focus:bg-accent dshx:focus:text-accent-foreground dshx:data-[inset]:pl-8 dshx:data-[state=open]:bg-accent dshx:data-[state=open]:text-accent-foreground dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4 dshx:[&_svg:not([class*=text-])]:text-muted-foreground',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="dshx:ml-auto dshx:size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        'dshx:z-[1100] dshx:min-w-[8rem] dshx:origin-(--radix-dropdown-menu-content-transform-origin) dshx:overflow-hidden dshx:rounded-md dshx:border dshx:bg-popover dshx:p-1 dshx:text-popover-foreground dshx:shadow-lg dshx:data-[side=bottom]:slide-in-from-top-2 dshx:data-[side=left]:slide-in-from-right-2 dshx:data-[side=right]:slide-in-from-left-2 dshx:data-[side=top]:slide-in-from-bottom-2 dshx:data-[state=closed]:animate-out dshx:data-[state=closed]:fade-out-0 dshx:data-[state=closed]:zoom-out-95 dshx:data-[state=open]:animate-in dshx:data-[state=open]:fade-in-0 dshx:data-[state=open]:zoom-in-95',
        className,
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
