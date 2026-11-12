import * as React from 'react'
import { cn } from '../../lib/utils.js'
import { useViewportClamp } from '../../hooks/viewport-clamp.js'
import { KeyHint, keysAria } from './kbd.js'
import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react'
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui'

function ContextMenu({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

function ContextMenuGroup({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
}

function ContextMenuPortal({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  return <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
}

function ContextMenuSub({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />
}

function ContextMenuRadioGroup({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.RadioGroup>) {
  return <ContextMenuPrimitive.RadioGroup data-slot="context-menu-radio-group" {...props} />
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        'dshx:flex dshx:cursor-default dshx:items-center dshx:rounded-sm dshx:px-2 dshx:py-1.5 dshx:text-sm dshx:outline-hidden dshx:select-none dshx:focus:bg-accent dshx:focus:text-accent-foreground dshx:data-[inset]:pl-8 dshx:data-[state=open]:bg-accent dshx:data-[state=open]:text-accent-foreground dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4 dshx:[&_svg:not([class*=text-])]:text-muted-foreground',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="dshx:ml-auto" />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  const clampRef = useViewportClamp()
  return (
    <ContextMenuPrimitive.SubContent
      ref={clampRef}
      data-slot="context-menu-sub-content"
      className={cn(
        'dshx:z-[1100] dshx:min-w-[8rem] dshx:origin-(--radix-context-menu-content-transform-origin) dshx:overflow-hidden dshx:rounded-md dshx:border dshx:bg-popover dshx:p-1 dshx:text-popover-foreground dshx:shadow-lg dshx:data-[side=bottom]:slide-in-from-top-2 dshx:data-[side=left]:slide-in-from-right-2 dshx:data-[side=right]:slide-in-from-left-2 dshx:data-[side=top]:slide-in-from-bottom-2 dshx:data-[state=closed]:animate-out dshx:data-[state=closed]:fade-out-0 dshx:data-[state=closed]:zoom-out-95 dshx:data-[state=open]:animate-in dshx:data-[state=open]:fade-in-0 dshx:data-[state=open]:zoom-in-95',
        className,
      )}
      {...props}
    />
  )
}

function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          'dshx:z-[1100] dshx:max-h-(--radix-context-menu-content-available-height) dshx:min-w-[8rem] dshx:origin-(--radix-context-menu-content-transform-origin) dshx:overflow-x-hidden dshx:overflow-y-auto dshx:rounded-md dshx:border dshx:bg-popover dshx:p-1 dshx:text-popover-foreground dshx:shadow-md dshx:data-[side=bottom]:slide-in-from-top-2 dshx:data-[side=left]:slide-in-from-right-2 dshx:data-[side=right]:slide-in-from-left-2 dshx:data-[side=top]:slide-in-from-bottom-2 dshx:data-[state=closed]:animate-out dshx:data-[state=closed]:fade-out-0 dshx:data-[state=closed]:zoom-out-95 dshx:data-[state=open]:animate-in dshx:data-[state=open]:fade-in-0 dshx:data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  inset,
  variant = 'default',
  keys,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean
  variant?: 'default' | 'destructive'
  /** The key that runs the same verb outside the menu (a dshx `Command` key spec); shown at the row's end. */
  keys?: string | readonly string[]
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        'dshx:relative dshx:flex dshx:cursor-default dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:px-2 dshx:py-1.5 dshx:text-sm dshx:outline-hidden dshx:select-none dshx:focus:bg-accent dshx:focus:text-accent-foreground dshx:data-[disabled]:pointer-events-none dshx:data-[disabled]:opacity-50 dshx:data-[inset]:pl-8 dshx:data-[variant=destructive]:text-destructive dshx:data-[variant=destructive]:focus:bg-destructive/10 dshx:data-[variant=destructive]:focus:text-destructive dshx:dark:data-[variant=destructive]:focus:bg-destructive/20 dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4 dshx:[&_svg:not([class*=text-])]:text-muted-foreground dshx:data-[variant=destructive]:*:[svg]:text-destructive!',
        className,
      )}
      aria-keyshortcuts={keysAria(keys)}
      {...props}
    >
      {children}
      {/* The item says its keys through aria-keyshortcuts; the keycaps are for the eye, out of its accessible name. */}
      {keys === undefined ? null : <ContextMenuShortcut keys={keys} aria-hidden="true" />}
    </ContextMenuPrimitive.Item>
  )
}

function ContextMenuCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      className={cn(
        'dshx:relative dshx:flex dshx:cursor-default dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:py-1.5 dshx:pr-2 dshx:pl-8 dshx:text-sm dshx:outline-hidden dshx:select-none dshx:focus:bg-accent dshx:focus:text-accent-foreground dshx:data-[disabled]:pointer-events-none dshx:data-[disabled]:opacity-50 dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    >
      <span className="dshx:pointer-events-none dshx:absolute dshx:left-2 dshx:flex dshx:size-3.5 dshx:items-center dshx:justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <CheckIcon className="dshx:size-4" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  )
}

function ContextMenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.RadioItem>) {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      className={cn(
        'dshx:relative dshx:flex dshx:cursor-default dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:py-1.5 dshx:pr-2 dshx:pl-8 dshx:text-sm dshx:outline-hidden dshx:select-none dshx:focus:bg-accent dshx:focus:text-accent-foreground dshx:data-[disabled]:pointer-events-none dshx:data-[disabled]:opacity-50 dshx:[&_svg]:pointer-events-none dshx:[&_svg]:shrink-0 dshx:[&_svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    >
      <span className="dshx:pointer-events-none dshx:absolute dshx:left-2 dshx:flex dshx:size-3.5 dshx:items-center dshx:justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <CircleIcon className="dshx:size-2 dshx:fill-current" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  )
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn('dshx:px-2 dshx:py-1.5 dshx:text-sm dshx:font-medium dshx:text-foreground dshx:data-[inset]:pl-8', className)}
      {...props}
    />
  )
}

function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator data-slot="context-menu-separator" className={cn('dshx:-mx-1 dshx:my-1 dshx:h-px dshx:bg-border', className)} {...props} />
  )
}

function ContextMenuShortcut({ className, keys, children, ...props }: React.ComponentProps<'span'> & { keys?: string | readonly string[] }) {
  if (keys !== undefined) return <KeyHint keys={keys} className={cn('dshx:ml-auto dshx:pl-4', className)} data-slot="context-menu-shortcut" {...props} />
  return (
    <span data-slot="context-menu-shortcut" className={cn('dshx:ml-auto dshx:text-xs dshx:tracking-widest dshx:text-muted-foreground', className)} {...props}>
      {children}
    </span>
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}
