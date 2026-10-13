'use client'

import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { Select as SelectPrimitive } from 'radix-ui'

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({ ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: 'sm' | 'default'
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        'dshx:flex dshx:w-fit dshx:items-center dshx:justify-between dshx:gap-2 dshx:rounded-md dshx:border dshx:border-input dshx:bg-transparent dshx:px-2.5 dshx:py-1.5 dshx:text-sm dshx:whitespace-nowrap dshx:shadow-xs dshx:transition-[color,box-shadow] dshx:outline-none dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-not-allowed dshx:disabled:opacity-50 dshx:aria-invalid:border-destructive dshx:aria-invalid:ring-destructive/20 dshx:data-[placeholder]:text-muted-foreground dshx:data-[size=default]:h-8 dshx:data-[size=sm]:h-7 dshx:*:data-[slot=select-value]:line-clamp-1 dshx:*:data-[slot=select-value]:flex dshx:*:data-[slot=select-value]:items-center dshx:*:data-[slot=select-value]:gap-2 dshx:dark:bg-input/30 dshx:dark:hover:bg-input/50 dshx:dark:aria-invalid:ring-destructive/40 dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4 dshx:[&_svg:not([class*=text-])]:text-muted-foreground',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="dshx:size-4 dshx:opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({ className, children, position = 'item-aligned', align = 'center', ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          'dshx:relative dshx:z-[1100] dshx:max-h-(--radix-select-content-available-height) dshx:min-w-[8rem] dshx:origin-(--radix-select-content-transform-origin) dshx:overflow-x-hidden dshx:overflow-y-auto dshx:rounded-md dshx:border dshx:bg-popover dshx:text-popover-foreground dshx:shadow-md dshx:data-[side=bottom]:slide-in-from-top-2 dshx:data-[side=left]:slide-in-from-right-2 dshx:data-[side=right]:slide-in-from-left-2 dshx:data-[side=top]:slide-in-from-bottom-2 dshx:data-[state=closed]:animate-out dshx:data-[state=closed]:fade-out-0 dshx:data-[state=closed]:zoom-out-95 dshx:data-[state=open]:animate-in dshx:data-[state=open]:fade-in-0 dshx:data-[state=open]:zoom-in-95',
          position === 'popper' &&
            'dshx:data-[side=bottom]:translate-y-1 dshx:data-[side=left]:-translate-x-1 dshx:data-[side=right]:translate-x-1 dshx:data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        align={align}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            'dshx:p-1',
            position === 'popper' && 'dshx:h-[var(--radix-select-trigger-height)] dshx:w-full dshx:min-w-[var(--radix-select-trigger-width)] dshx:scroll-my-1',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label data-slot="select-label" className={cn('dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground', className)} {...props} />
  )
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'dshx:relative dshx:flex dshx:w-full dshx:cursor-default dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:py-1.5 dshx:pr-8 dshx:pl-2 dshx:text-sm dshx:outline-hidden dshx:select-none dshx:focus:bg-accent dshx:focus:text-accent-foreground dshx:data-[disabled]:pointer-events-none dshx:data-[disabled]:opacity-50 dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4 dshx:[&_svg:not([class*=text-])]:text-muted-foreground dshx:*:[span]:last:flex dshx:*:[span]:last:items-center dshx:*:[span]:last:gap-2',
        className,
      )}
      {...props}
    >
      <span data-slot="select-item-indicator" className="dshx:absolute dshx:right-2 dshx:flex dshx:size-3.5 dshx:items-center dshx:justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="dshx:size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('dshx:pointer-events-none dshx:-mx-1 dshx:my-1 dshx:h-px dshx:bg-border', className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn('dshx:flex dshx:cursor-default dshx:items-center dshx:justify-center dshx:py-1', className)}
      {...props}
    >
      <ChevronUpIcon className="dshx:size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn('dshx:flex dshx:cursor-default dshx:items-center dshx:justify-center dshx:py-1', className)}
      {...props}
    >
      <ChevronDownIcon className="dshx:size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
