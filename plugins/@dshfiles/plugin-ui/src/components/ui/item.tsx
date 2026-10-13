import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'
import { Slot } from 'radix-ui'

import { Separator } from './separator.js'

function ItemGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div role="list" data-slot="item-group" className={cn('dshx:group/item-group dshx:flex dshx:flex-col', className)} {...props} />
}

function ItemSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return <Separator data-slot="item-separator" orientation="horizontal" className={cn('dshx:my-0', className)} {...props} />
}

const itemVariants = cva(
  'dshx:group/item dshx:flex dshx:flex-wrap dshx:items-center dshx:rounded-md dshx:border dshx:border-transparent dshx:text-sm dshx:transition-colors dshx:duration-100 dshx:outline-none dshx:focus-visible:border-ring dshx:focus-visible:ring-[3px] dshx:focus-visible:ring-ring/50 dshx:[a]:transition-colors dshx:[a]:hover:bg-accent/50',
  {
    variants: {
      variant: {
        default: 'dshx:bg-transparent',
        outline: 'dshx:border-border',
        muted: 'dshx:bg-muted/50',
      },
      size: {
        default: 'dshx:gap-4 dshx:p-4',
        sm: 'dshx:gap-2.5 dshx:px-4 dshx:py-3',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Item({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof itemVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'div'
  return <Comp data-slot="item" data-variant={variant} data-size={size} className={cn(itemVariants({ variant, size, className }))} {...props} />
}

const itemMediaVariants = cva(
  'dshx:flex dshx:shrink-0 dshx:items-center dshx:justify-center dshx:gap-2 dshx:group-has-[[data-slot=item-description]]/item:translate-y-0.5 dshx:group-has-[[data-slot=item-description]]/item:self-start dshx:[&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'dshx:bg-transparent',
        icon: 'dshx:size-8 dshx:rounded-sm dshx:border dshx:bg-muted dshx:[&_svg:not([class*=size-])]:size-4',
        image: 'dshx:size-10 dshx:overflow-hidden dshx:rounded-sm dshx:[&_img]:size-full dshx:[&_img]:object-cover',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function ItemMedia({ className, variant = 'default', ...props }: React.ComponentProps<'div'> & VariantProps<typeof itemMediaVariants>) {
  return <div data-slot="item-media" data-variant={variant} className={cn(itemMediaVariants({ variant, className }))} {...props} />
}

function ItemContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-content"
      className={cn('dshx:flex dshx:flex-1 dshx:flex-col dshx:gap-1 dshx:[&+[data-slot=item-content]]:flex-none', className)}
      {...props}
    />
  )
}

function ItemTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-title"
      className={cn('dshx:flex dshx:w-fit dshx:items-center dshx:gap-2 dshx:text-sm dshx:leading-snug dshx:font-medium', className)}
      {...props}
    />
  )
}

function ItemDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="item-description"
      className={cn(
        'dshx:line-clamp-2 dshx:text-sm dshx:leading-normal dshx:font-normal dshx:text-balance dshx:text-muted-foreground',
        'dshx:[&>a]:underline dshx:[&>a]:underline-offset-4 dshx:[&>a:hover]:text-primary',
        className,
      )}
      {...props}
    />
  )
}

function ItemActions({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="item-actions" className={cn('dshx:flex dshx:items-center dshx:gap-2', className)} {...props} />
}

function ItemHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="item-header" className={cn('dshx:flex dshx:basis-full dshx:items-center dshx:justify-between dshx:gap-2', className)} {...props} />
}

function ItemFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="item-footer" className={cn('dshx:flex dshx:basis-full dshx:items-center dshx:justify-between dshx:gap-2', className)} {...props} />
}

export { Item, ItemMedia, ItemContent, ItemActions, ItemGroup, ItemSeparator, ItemTitle, ItemDescription, ItemHeader, ItemFooter }
